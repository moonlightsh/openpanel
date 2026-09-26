// 汉化规则单一权威源（设计 §5）。
// extract.mjs（提取）与 plugin/index.ts（构建期改写）共用本模块，
// 确保「提取器看到的」与「改写器改的」逐字节一致，且 msgid 规范化完全同源。
import { decodeHTML } from 'entities';

// ---- 白名单 / 拒结清单（§5.1 / §5.3）----
export const ATTR_WHITELIST = new Set([
  'placeholder', 'title', 'label', 'alt', 'aria-label', 'description',
  'tooltip', 'emptyMessage', 'confirmText', 'cancelText', 'subtitle', 'heading',
]);
export const OBJ_KEY_WHITELIST = new Set([
  'label', 'title', 'description', 'placeholder', 'subtitle', 'heading',
  'tooltip', 'confirmText', 'cancelText', 'emptyMessage', 'message', 'cta', 'helperText', 'text',
]);
// 注意：includes/length/startsWith/endsWith 是 String/Array 通用方法，曾误抓
// name.includes("Gradient") 等组件名匹配（chart-defs.ts）。仅保留真正的 zod 校验方法。
export const ZOD_METHODS = new Set(['min', 'max', 'email', 'url', 'regex', 'refine', 'nonempty', 'uuid']);
export const REJECT_TAGS = /^(code|pre)$/i;
export const REJECT_COMPONENT = /(CodeMirror|CodeBlock|SyntaxHighlight|Highlight|Editor)/;

// ---- 统一文件范围（设计 §5）----
// plugin（改写）与 extract（提取）共用本函数，杠死“提取到的”与“改写的”范围漂移（B4）。
// 仅：apps/start/src 全量 + 明确列入的共享 UI 文件。
// 不再 blanket packages/**：
//   - 避免误改 validation/db/协议等非 UI 语义数据（F3）；
//   - 避免提取器扫到 dashboard 未 import 的包（email/queue 等）产生虚假 catalog。
// 共享 UI 文件白名单（绝对路径后缀）：仅列入被 apps/start 直接渲染的共享 UI 文案文件。
// 注意：只加确属 UI 展示文案的文件；ai/*（LLM 提示词）、validation/*（zod schema）、
// db/*（内部）等即便含 label/title/description 键也严禁列入，避免误译提示词/协议元数据。
export const SHARED_UI_FILES = [
  '/packages/constants/index.ts',
  '/packages/payments/src/subscription-state-meta.ts', // 订阅状态 badge/title/description/cta
  '/packages/importer/src/providers/metadata.ts', // 导入源 description（name 为品牌名，不在白名单）
];
export function shouldTranslateFile(rawPath) {
  const s = String(rawPath).replace(/\\/g, '/');
  if (s.includes('/node_modules/')) { return false; }
  if (/\.(test|spec)\.(ts|tsx)$/.test(s)) { return false; }
  if (/\.gen\.ts$/.test(s)) { return false; }
  if (s.endsWith('/routeTree.gen.ts')) { return false; }
  if (s.includes('/apps/start/src/') && /\.(ts|tsx)$/.test(s)) { return true; }
  if (SHARED_UI_FILES.some((f) => s.endsWith(f))) { return true; }
  return false;
}

// 代码形态串：纯小写+点/斜杠/下划线/冒号/井号，或 URL
export const CODE_FORM = /^[a-z0-9_.\-/:#@]+$/;
export const URL_FORM = /^https?:\/\//;

// ---- 规范化（§4.4：解码实体 -> 折叠空白 -> 去首尾空白；提取与运行时必须同源）----
export function normalize(raw) {
  let s = decodeHTML(raw);
  s = s.replace(/[\s\u00A0]+/g, ' ').trim();
  return s;
}
export function stripPlaceholders(s) {
  return s.replace(/\{\d+\}/g, '').trim();
}
export function isRejected(msgid) {
  const bare = stripPlaceholders(msgid);
  if (bare.length <= 1) { return true; }
  if (!/[A-Za-z]/.test(bare)) { return true; // 无字母
}
  if (URL_FORM.test(bare)) { return true; }
  // 代码形态判定仅对“无占位符”的串生效：带 {N} 占位符的是 UI 插值模板，
  // 其占位符之间的短小写连接词（at/to/of 等）不是代码标识符（如 aria-label 的
  // `{0} at {1}`）。避免 CODE_FORM 误拒这类无障碍文案。
  const hasPlaceholder = /\{\d+\}/.test(msgid);
  if (!hasPlaceholder && CODE_FORM.test(bare)) { return true; // 代码形态
}
  if (/^\d[\d.,\s]*$/.test(bare)) { return true; // 纯数字
}
  return false;
}

// ---- AST helpers ----
export function tagName(node) {
  const n = node.openingElement ? node.openingElement.name : node.name;
  if (!n) { return ''; }
  if (n.type === 'JSXIdentifier') { return n.name; }
  if (n.type === 'JSXMemberExpression') { return n.property?.name || ''; }
  return '';
}
export function isStrLit(n) {
  return n && n.type === 'StringLiteral';
}
export function tplNoExpr(n) {
  return n && n.type === 'TemplateLiteral' && n.expressions.length === 0;
}
export function tplToMsg(n) {
  // 模板串 -> 位置占位符
  let out = '';
  let i = 0;
  for (let k = 0; k < n.quasis.length; k++) {
    out += n.quasis[k].value.cooked ?? n.quasis[k].value.raw ?? '';
    if (k < n.expressions.length) { out += `{${i++}}`; }
  }
  return out;
}

// 值上下文（toast 实参 / 白名单对象属性值 / JSX 子表达式容器）下，递归
// ConditionalExpression / LogicalExpression 的分支，收集可译字符串叶子（StringLiteral
// 或 TemplateLiteral）。extract 与 plugin 共用本函数，保证枚举顺序与结果完全一致
//（设计 §5 “同一遍历”）。标识符/成员表达式/调用等非字符串节点返回空，绝不误抽动态数据。
export function collectValueStringLeaves(node) {
  if (!node) { return []; }
  if (isStrLit(node)) { return [node]; }
  if (node.type === 'TemplateLiteral') {
    // 模板本身是可译叶子；同时递归其插值表达式，捕获嵌套在
    // 模板里的条件/模板字符串（如 `...paused${resumesAt ? `, and billing resumes on ${x}` : ''}.`），
    // 消除嵌套模板导致的中英混排（Round-4 BLOCKER）。
    const leaves = [node];
    for (const e of node.expressions) { leaves.push(...collectValueStringLeaves(e)); }
    return leaves;
  }
  if (node.type === 'ConditionalExpression') {
    return [...collectValueStringLeaves(node.consequent), ...collectValueStringLeaves(node.alternate)];
  }
  if (node.type === 'LogicalExpression') {
    return [...collectValueStringLeaves(node.left), ...collectValueStringLeaves(node.right)];
  }
  return [];
}
export function hasRejectAncestor(path) {
  let p = path.parentPath;
  while (p) {
    if (p.isJSXElement?.()) {
      const t = tagName(p.node);
      if (REJECT_TAGS.test(t) || REJECT_COMPONENT.test(t)) { return true; }
    }
    p = p.parentPath;
  }
  return false;
}

// ---- 元素级整句提取（§5.2）----
// 统一实现：extract 用 mergeChildren 取合并串；plugin 用 collectChildren 取结构化结果。
// 二者遍历顺序与占位符分配规则完全一致。
//
// 返回：{ raw, dynamics, hasElement, hasTextLetters }
//   raw            —— 合并后的原始串（含 {0}{1} 占位符，未规范化）
//   dynamics       —— 与占位符 {0}{1}... 一一对应的 AST 节点（表达式或 JSX 子元素），按出现顺序
//   hasElement     —— dynamics 中是否含 JSX 子元素/Fragment/Spread（决定 __opT vs __opTx）
//   hasTextLetters —— 合并的字面文本中是否含字母（无字母则整体交给子元素各自处理）
export function collectChildren(children) {
  const parts = [];
  const dynamics = [];
  let idx = 0;
  let hasTextLetters = false;
  let hasElement = false;
  for (const c of children) {
    if (c.type === 'JSXText') {
      const dec = decodeHTML(c.value);
      parts.push(dec);
      if (/[A-Za-z]/.test(dec)) { hasTextLetters = true; }
    } else if (c.type === 'JSXExpressionContainer') {
      const e = c.expression;
      if (!e || e.type === 'JSXEmptyExpression') { continue; }
      if (isStrLit(e)) {
        if (e.value.trim() === '') { parts.push(' '); // {' '} 当字面空白（§5.4.3）
}
        else {
          parts.push(e.value);
          if (/[A-Za-z]/.test(e.value)) { hasTextLetters = true; }
        }
      } else if (tplNoExpr(e)) {
        const v = e.quasis[0].value.cooked ?? '';
        parts.push(v);
        if (/[A-Za-z]/.test(v)) { hasTextLetters = true; }
      } else {
        parts.push(`{${idx++}}`);
        dynamics.push({ kind: 'expr', node: e });
      }
    } else if (c.type === 'JSXElement' || c.type === 'JSXFragment') {
      parts.push(`{${idx++}}`);
      dynamics.push({ kind: 'element', node: c });
      hasElement = true;
    } else if (c.type === 'JSXSpreadChild') {
      parts.push(`{${idx++}}`);
      dynamics.push({ kind: 'element', node: c });
      hasElement = true;
    }
  }
  return { raw: parts.join(''), dynamics, hasElement, hasTextLetters };
}

// extract 兼容包装：无字母返回 null，否则返回合并串（与历史行为逐字节一致）。
export function mergeChildren(children) {
  const r = collectChildren(children);
  if (!r.hasTextLetters) { return null; }
  return r.raw;
}
