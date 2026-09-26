// 运行时纯函数单一源（设计 §4.3 / §5.2）。
// 说明：这些函数被 plugin/index.ts 的 buildRuntime() 通过 Function.prototype.toString()
// 原样内联进虚模块 `virtual:op-i18n`，同时被单测直接 import。单一源，杜绝"内联字符串"
// 与"被测逻辑"漂移。因此本文件必须自包含、不得引用外部作用域变量。

// 值插值：把 "{0}" 按数字索引替换为 args[n]。
//   - 越界(undefined)：保留 "{n}" 字面，便于暴露字典占位符缺陷，而不是静默产出垃圾；
//   - null：替换为空串；
//   - 其它：String(a)。
// 允许译文重排/省略占位符（多余的 args 被忽略）。
export function fmt(text, args) {
  return text.replace(/\{(\d+)\}/g, (whole, n) => {
    const a = args[Number(n)];
    if (a === undefined) {
      return whole;
    }
    if (a === null) {
      return '';
    }
    return String(a);
  });
}

// 元素插值：把 "{0}" 按数字索引替换为 parts[n]（可为 ReactNode），返回节点数组。
//   - 越界(undefined)：跳过，不 push undefined；
//   - 允许译文重排/省略占位符。
export function buildNodes(text, parts) {
  const nodes = [];
  const re = /\{(\d+)\}/g;
  let last = 0;
  let m = re.exec(text);
  while (m !== null) {
    if (m.index > last) {
      nodes.push(text.slice(last, m.index));
    }
    const p = parts[Number(m[1])];
    if (p !== undefined) {
      nodes.push(p);
    }
    last = m.index + m[0].length;
    m = re.exec(text);
  }
  if (last < text.length) {
    nodes.push(text.slice(last));
  }
  return nodes;
}

// 安全解析字典文本（构建期用；F2）：解析失败 / 非对象 / 数组 / 含非字符串值
// 一律回退为 {}，保证虚模块永远是合法 JS 且运行时回退英文，绝不因字典损坏而崩溃。
export function safeParseDict(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }
  for (const v of Object.values(parsed)) {
    if (typeof v !== 'string') {
      return {};
    }
  }
  return parsed;
}

// ---- 占位符完整性（构建期门禁，设计 §5.2）----
export function placeholderSet(s) {
  const set = new Set();
  const re = /\{(\d+)\}/g;
  let m = re.exec(s);
  while (m !== null) {
    set.add(Number(m[1]));
    m = re.exec(s);
  }
  return set;
}
// 译文相对原文"多出"的占位符索引（合法译文必须为原文的子集；允许重排/省略）。
export function extraPlaceholders(en, cn) {
  const enP = placeholderSet(en);
  const cnP = placeholderSet(cn);
  return [...cnP].filter((x) => !enP.has(x)).sort((a, b) => a - b);
}
