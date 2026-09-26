// vite-plugin-op-i18n —— 构建期 AST 改写插件（设计 §4.2 / §4.3 / §5）。
//
// 职责：
//  1. transform：用 @babel/parser 取 AST 位置，复用 shared/rules.mjs 的同一套规则找到改写点，
//     用 magic-string 做区间外科替换，把可翻译文案包成 __opT(...) / __opTx(...) 调用。
//  2. resolveId/load：提供虚模块 `virtual:op-i18n` 运行时，字典编译期静态内联。
//  3. 把 <html lang="en"> 改写为 zh-CN（AST 规则，不动 __root.tsx）。
//
// 与 extract 共用 shared/rules.mjs，保证「提取到的」与「改写的」逐字节一致。
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import MagicString from 'magic-string';
// @ts-ignore @babel/traverse 无官方类型；本插件对 AST 一律用 any
import _traverse from '@babel/traverse';
import {
  ATTR_WHITELIST,
  OBJ_KEY_WHITELIST,
  REJECT_COMPONENT,
  REJECT_TAGS,
  ZOD_METHODS,
  collectChildren,
  hasRejectAncestor,
  isRejected,
  isStrLit,
  normalize,
  tagName,
  tplNoExpr,
  tplToMsg,
} from '../shared/rules.mjs';

const traverse = (_traverse as any).default || _traverse;

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');
const DICT_PATH = join(PKG_ROOT, 'locales', 'zh-CN.json');
const REJECT_PATH = join(PKG_ROOT, 'catalog', 'reject.json');

const VIRTUAL_ID = 'virtual:op-i18n';
const RESOLVED_VIRTUAL_ID = '\0virtual:op-i18n';

// 拒结清单：extract 已抓到但人工判定不翻译的词条（字段名/示例值/类名等）。
// 命中即不包 __opT，保持英文字面量，零风险（§5.4）。
function loadRejectSet(): Set<string> {
  try {
    const arr = JSON.parse(readFileSync(REJECT_PATH, 'utf8')) as Array<{ en: string }>;
    return new Set(arr.map((e) => e.en));
  } catch {
    return new Set();
  }
}

// ---- 文件过滤（§5.3：排除生成文件/测试/node_modules）----
function stripQuery(id: string): string {
  const i = id.indexOf('?');
  return i === -1 ? id : id.slice(0, i);
}
function shouldTransform(id: string): boolean {
  const p = stripQuery(id).replace(/\\/g, '/');
  if (p.includes('/node_modules/')) return false;
  if (/\.(test|spec)\.(ts|tsx)$/.test(p)) return false;
  if (/\.gen\.ts$/.test(p)) return false;
  if (p.endsWith('/routeTree.gen.ts')) return false;
  // apps/start/src 下的 .ts/.tsx
  if (p.includes('/apps/start/src/') && /\.(ts|tsx)$/.test(p)) return true;
  // packages/** 里的 UI 文案 .ts（排除本包自身，避免自引用）
  if (p.includes('/packages/') && !p.includes('/packages/i18n-zh/') && /\.ts$/.test(p)) return true;
  return false;
}

// ---- 源码片段取值 ----
function src(code: string, node: any): string {
  return code.slice(node.start, node.end);
}
function jsExpr(str: string): string {
  return JSON.stringify(str);
}
function buildT(msgid: string, argSrcs: string[]): string {
  const args = argSrcs.length ? ', ' + argSrcs.join(', ') : '';
  return `__opT(${jsExpr(msgid)}${args})`;
}
function buildTx(msgid: string, partSrcs: string[]): string {
  return `__opTx(${jsExpr(msgid)}, [${partSrcs.join(', ')}])`;
}

// 模板串 -> {msgid, argSrcs}
function tplParts(code: string, node: any): { msgid: string; argSrcs: string[] } {
  return { msgid: tplToMsg(node), argSrcs: node.expressions.map((e: any) => src(code, e)) };
}

interface Edit {
  start: number;
  end: number;
  replacement: string;
  needsRuntime: boolean; // 是否需要注入 __opT/__opTx（lang 改写不需要）
}

// 核心：解析 -> 遍历规则 -> 收集编辑 -> 去重叠 -> magic-string 替换。
function rewriteFile(code: string, rejectSet: Set<string>): { code: string; map: any } | null {
  let ast: any;
  try {
    ast = parse(code, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx', 'decorators-legacy', 'importAttributes', 'explicitResourceManagement'],
    });
  } catch {
    return null; // 解析失败：放弃改写，保持原文（§G3 不可退化）
  }

  const edits: Edit[] = [];
  const accept = (msgid: string) => !!msgid && !isRejected(msgid) && !rejectSet.has(msgid);

  traverse(ast, {
    JSXElement(path: any) {
      const t = tagName(path.node);
      if (REJECT_TAGS.test(t) || REJECT_COMPONENT.test(t)) return;
      if (hasRejectAncestor(path)) return;
      // <html lang="en"> -> zh-CN（属性级，在 JSXAttribute 里统一处理）
      const r = collectChildren(path.node.children);
      if (!r.hasTextLetters) return;
      const msgid = normalize(r.raw);
      if (!accept(msgid)) return;
      const oe = path.node.openingElement;
      const ce = path.node.closingElement;
      if (!ce) return; // 自闭合无 children
      const argSrcs = r.dynamics.map((d: any) => src(code, d.node));
      const replacement = r.hasElement
        ? `{${buildTx(msgid, argSrcs)}}`
        : `{${buildT(msgid, argSrcs)}}`;
      edits.push({ start: oe.end, end: ce.start, replacement, needsRuntime: true });
    },
    JSXFragment(path: any) {
      if (hasRejectAncestor(path)) return;
      const r = collectChildren(path.node.children);
      if (!r.hasTextLetters) return;
      const msgid = normalize(r.raw);
      if (!accept(msgid)) return;
      const of_ = path.node.openingFragment;
      const cf = path.node.closingFragment;
      const argSrcs = r.dynamics.map((d: any) => src(code, d.node));
      const replacement = r.hasElement
        ? `{${buildTx(msgid, argSrcs)}}`
        : `{${buildT(msgid, argSrcs)}}`;
      edits.push({ start: of_.end, end: cf.start, replacement, needsRuntime: true });
    },
    JSXAttribute(path: any) {
      const nm = path.node.name;
      const name =
        nm.type === 'JSXIdentifier'
          ? nm.name
          : nm.type === 'JSXNamespacedName'
            ? `${nm.namespace.name}:${nm.name.name}`
            : '';
      const v = path.node.value;
      if (!v) return;
      // <html lang="en"> -> "zh-CN"（§5.1；不动源文件）
      if (name === 'lang' && isStrLit(v) && v.value === 'en') {
        const parent = path.parent;
        if (parent && parent.type === 'JSXOpeningElement' && tagName({ openingElement: parent }) === 'html') {
          edits.push({ start: v.start, end: v.end, replacement: '"zh-CN"', needsRuntime: false });
        }
        return;
      }
      if (!ATTR_WHITELIST.has(name)) return;
      if (isStrLit(v)) {
        const msgid = normalize(v.value);
        if (!accept(msgid)) return;
        edits.push({ start: v.start, end: v.end, replacement: `{${buildT(msgid, [])}}`, needsRuntime: true });
      } else if (v.type === 'JSXExpressionContainer') {
        const e = v.expression;
        if (isStrLit(e)) {
          const msgid = normalize(e.value);
          if (!accept(msgid)) return;
          edits.push({ start: v.start, end: v.end, replacement: `{${buildT(msgid, [])}}`, needsRuntime: true });
        } else if (tplNoExpr(e)) {
          const msgid = normalize(e.quasis[0].value.cooked ?? '');
          if (!accept(msgid)) return;
          edits.push({ start: v.start, end: v.end, replacement: `{${buildT(msgid, [])}}`, needsRuntime: true });
        } else if (e && e.type === 'TemplateLiteral') {
          const { msgid: raw, argSrcs } = tplParts(code, e);
          const msgid = normalize(raw);
          if (!accept(msgid)) return;
          edits.push({ start: v.start, end: v.end, replacement: `{${buildT(msgid, argSrcs)}}`, needsRuntime: true });
        }
      }
    },
    CallExpression(path: any) {
      const callee = path.node.callee;
      let isToast = false;
      if (callee.type === 'MemberExpression' && callee.object?.type === 'Identifier' && callee.object.name === 'toast')
        isToast = true;
      if (callee.type === 'Identifier' && callee.name === 'toast') isToast = true;
      if (isToast) {
        for (const arg of path.node.arguments) rewriteExprString(code, arg, edits, accept);
      }
      if (
        callee.type === 'MemberExpression' &&
        callee.property?.type === 'Identifier' &&
        ZOD_METHODS.has(callee.property.name)
      ) {
        for (const arg of path.node.arguments) {
          if (arg.type === 'ObjectExpression') {
            for (const p of arg.properties) {
              if (p.type === 'ObjectProperty' && !p.computed) {
                const k = p.key.type === 'Identifier' ? p.key.name : p.key.type === 'StringLiteral' ? p.key.value : '';
                if (k === 'message') rewriteExprString(code, p.value, edits, accept);
              }
            }
          } else {
            rewriteExprString(code, arg, edits, accept);
          }
        }
      }
    },
    ObjectProperty(path: any) {
      const node = path.node;
      if (node.computed) return;
      const k = node.key.type === 'Identifier' ? node.key.name : node.key.type === 'StringLiteral' ? node.key.value : '';
      if (!OBJ_KEY_WHITELIST.has(k)) return;
      rewriteExprString(code, node.value, edits, accept);
    },
  });

  if (edits.length === 0) return null;
  return applyEdits(code, edits, ast);
}

// 表达式上下文里的字符串/模板改写（toast / zod / 对象属性）
function rewriteExprString(code: string, node: any, edits: Edit[], accept: (m: string) => boolean) {
  if (!node) return;
  if (isStrLit(node)) {
    const msgid = normalize(node.value);
    if (!accept(msgid)) return;
    edits.push({ start: node.start, end: node.end, replacement: buildT(msgid, []), needsRuntime: true });
  } else if (tplNoExpr(node)) {
    const msgid = normalize(node.quasis[0].value.cooked ?? '');
    if (!accept(msgid)) return;
    edits.push({ start: node.start, end: node.end, replacement: buildT(msgid, []), needsRuntime: true });
  } else if (node.type === 'TemplateLiteral') {
    const { msgid: raw, argSrcs } = tplParts(code, node);
    const msgid = normalize(raw);
    if (!accept(msgid)) return;
    edits.push({ start: node.start, end: node.end, replacement: buildT(msgid, argSrcs), needsRuntime: true });
  }
}

// 去重叠：按 start 升序、end 降序排列后，贪心保留最外层非重叠区间，
// 丢弃被包含的嵌套编辑（元素级整句会吞并其子节点文本，§5.2）。
function dedupeEdits(edits: Edit[]): Edit[] {
  const sorted = edits.slice().sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Edit[] = [];
  let coveredEnd = -1;
  for (const e of sorted) {
    if (e.start >= coveredEnd) {
      kept.push(e);
      coveredEnd = e.end;
    }
    // 否则被前一个更外层的编辑包含 -> 丢弃
  }
  return kept;
}

function importInsertOffset(ast: any): number {
  const body = ast.program.body;
  for (const n of body) {
    const isDirective = n.type === 'ExpressionStatement' && n.expression?.type === 'StringLiteral';
    if (!isDirective) return n.start;
  }
  return body.length ? body[body.length - 1].end : 0;
}

function applyEdits(code: string, edits: Edit[], ast?: any): { code: string; map: any } | null {
  const kept = dedupeEdits(edits);
  if (kept.length === 0) return null;
  const s = new MagicString(code);
  let needsRuntime = false;
  for (const e of kept) {
    s.overwrite(e.start, e.end, e.replacement, { contentOnly: true });
    if (e.needsRuntime) needsRuntime = true;
  }
  if (needsRuntime && ast) {
    const at = importInsertOffset(ast);
    s.appendLeft(at, `import { __opT, __opTx } from "${VIRTUAL_ID}";\n`);
  }
  return { code: s.toString(), map: s.generateMap({ hires: true }) };
}

// ---- 虚模块运行时（§4.3）----
// dict 编译期静态内联；locale 源 cookie op_locale，默认 zh-CN；
// dev 未命中推入 window.__OP_I18N_MISSES；OP_I18N_PSEUDO=1 时已翻译输出包 〖〗。
function buildRuntime(): string {
  let dictJson = '{}';
  try {
    dictJson = readFileSync(DICT_PATH, 'utf8').trim() || '{}';
  } catch {
    dictJson = '{}';
  }
  const pseudo = process.env.OP_I18N_PSEUDO === '1';
  return `// AUTO-GENERATED by vite-plugin-op-i18n（virtual:op-i18n）
const dict = ${dictJson};
const PSEUDO = ${pseudo};
const DEFAULT_LOCALE = "zh-CN";
const SUPPORTED = new Set(["zh-CN", "en"]);

function parseCookieLocale(cookieStr) {
  if (!cookieStr) return null;
  const m = /(?:^|;\\s*)op_locale=([^;]+)/.exec(cookieStr);
  if (!m) return null;
  let v = m[1];
  try { v = decodeURIComponent(v); } catch {}
  v = v.trim();
  return SUPPORTED.has(v) ? v : null;
}

function getLocale() {
  // 服务端中间件可写 globalThis.__OP_LOCALE 作为按请求 cookie 的转发种子（P1 接缝）
  if (typeof globalThis !== "undefined" && globalThis.__OP_LOCALE && SUPPORTED.has(globalThis.__OP_LOCALE)) {
    return globalThis.__OP_LOCALE;
  }
  if (typeof document !== "undefined") {
    return parseCookieLocale(document.cookie) || DEFAULT_LOCALE;
  }
  return DEFAULT_LOCALE; // SSR 默认 zh-CN（P0）
}

function recordMiss(msgid) {
  try {
    if (import.meta.env && import.meta.env.DEV && typeof window !== "undefined") {
      (window.__OP_I18N_MISSES || (window.__OP_I18N_MISSES = [])).push(msgid);
    }
  } catch {}
}

function lookup(msgid) {
  if (getLocale() === "en") return { text: msgid, hit: false }; // key 即英文，英文零字典
  const t = dict[msgid];
  if (t == null) { recordMiss(msgid); return { text: msgid, hit: false }; }
  return { text: t, hit: true };
}

function fmt(text, args) {
  return text.replace(/\\{(\\d+)\\}/g, (_, n) => {
    const a = args[Number(n)];
    return a == null ? "" : String(a);
  });
}

export function __opT(msgid, ...args) {
  const r = lookup(msgid);
  const out = fmt(r.text, args);
  return PSEUDO && r.hit ? "〖" + out + "〗" : out;
}
export const __t = __opT;

export function __opTx(msgid, parts) {
  const r = lookup(msgid);
  const nodes = [];
  const re = /\\{(\\d+)\\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(r.text))) {
    if (m.index > last) nodes.push(r.text.slice(last, m.index));
    nodes.push(parts[Number(m[1])]);
    last = m.index + m[0].length;
  }
  if (last < r.text.length) nodes.push(r.text.slice(last));
  if (PSEUDO && r.hit) { nodes.unshift("〖"); nodes.push("〗"); }
  return nodes;
}
export const __tx = __opTx;
`;
}

// ---- 插件工厂 ----
export default function opI18nPlugin() {
  const rejectSet = loadRejectSet();
  const cache = new Map<string, { code: string; map: any } | null>();

  return {
    name: 'vite-plugin-op-i18n',
    enforce: 'pre' as const,

    resolveId(id: string) {
      if (id === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID;
      return null;
    },
    load(id: string) {
      if (id === RESOLVED_VIRTUAL_ID) return buildRuntime();
      return null;
    },
    transform(code: string, id: string) {
      if (!shouldTransform(id)) return null;
      const key = createHash('sha1').update(id).update('\0').update(code).digest('hex');
      if (cache.has(key)) return cache.get(key);
      const result = rewriteFile(code, rejectSet);
      cache.set(key, result);
      return result;
    },
  };
}
