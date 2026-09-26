import { describe, expect, it } from 'vitest';
import { parseExpression } from '@babel/parser';
import { rewriteFile } from '../plugin/index.ts';
import { collectValueStringLeaves } from '../shared/rules.mjs';

// 便捷：改写并返回结果代码（null 视作空串，便于断言"未改写"）。
function rw(code: string, reject: string[] = []): string {
  const r = rewriteFile(code, new Set(reject));
  return r ? r.code : '';
}

describe('rewriteFile — JSX 文案改写', () => {
  it('纯文本 JSX 走 __opT', () => {
    const out = rw('const x = <div>Hello world</div>;');
    expect(out).toContain('__opT("Hello world")');
    expect(out).not.toMatch(/__opTx\(/); // 不得以 __opTx 调用形式改写
  });

  it('B1: 条件 JSX（逻辑表达式子节点）走 __opTx，不产生 String() 垃圾', () => {
    const out = rw('const x = <div>Select interval {cond && <b>x</b>}</div>;');
    expect(out).toContain('__opTx("Select interval {0}"');
    // 不得退化为 __opT 调用（那会 String(false) => "false"）
    expect(out).not.toMatch(/__opT\("Select interval/);
  });

  it('B1: 三元条件 JSX 也走 __opTx', () => {
    const out = rw('const x = <div>Status {ok ? <b>y</b> : <i>n</i>}</div>;');
    expect(out).toContain('__opTx("Status {0}"');
  });

  it('B2: 混排子元素的内部文案被递归翻译（不再保留英文原文）', () => {
    const out = rw('const x = <p>Already have an account? <a>Sign in</a></p>;');
    expect(out).toContain('__opTx("Already have an account? {0}"');
    // 关键：子元素 <a>Sign in</a> 内部也被包成 __opT("Sign in")
    expect(out).toContain('__opT("Sign in")');
    // part 里不得残留未改写的原始子文本
    expect(out).not.toMatch(/\[<a>Sign in<\/a>\]/);
  });

  it('纯值插值（数字/字符串）走 __opT', () => {
    const out = rw('const x = <span>Showing {n} items</span>;');
    expect(out).toContain('__opT("Showing {0} items"');
    expect(out).not.toMatch(/__opTx\(/);
  });

  it('白名单属性字符串走 __opT', () => {
    const out = rw('const x = <input placeholder="Search" />;');
    expect(out).toContain('placeholder={__opT("Search")}');
  });

  it('<html lang="en"> 改写为 zh-CN 且不注入运行时', () => {
    const out = rw('const x = <html lang="en"><body>Hi there</body></html>;');
    expect(out).toContain('"zh-CN"');
  });
});

describe('rewriteFile — 拒结与边界', () => {
  it('代码形态串不改写', () => {
    expect(rw('const x = <div>foo.bar.baz</div>;')).toBe('');
  });

  it('rejectSet 命中的词条不改写（如 Gradient）', () => {
    expect(rw('const x = <div>Gradient</div>;', ['Gradient'])).toBe('');
  });

  it('<pre>/<code> 内文本不改写', () => {
    expect(rw('const x = <pre>Hello world here</pre>;')).toBe('');
    expect(rw('const x = <code>Hello world here</code>;')).toBe('');
  });

  it('HTML 实体解码后作为 msgid（&nbsp; -> 空格）', () => {
    const out = rw('const x = <div>Hello&nbsp;world</div>;');
    expect(out).toContain('__opT("Hello world")');
  });

  it("{' '} 当字面空白参与合并，不作为动态占位符", () => {
    const out = rw("const x = <div>Hello{' '}world</div>;");
    expect(out).toContain('__opT("Hello world")');
    expect(out).not.toContain('{0}');
  });

  it('无字母内容（纯符号）不改写', () => {
    expect(rw('const x = <div>+++ ---</div>;')).toBe('');
  });
});

describe('rewriteFile — 条件/逻辑表达式中的静态字符串（Round-3 BLOCKER）', () => {
  it('JSX children 三元：两个字符串分支都被包 __opT，且保留三元结构', () => {
    const out = rw("const x = <span>{ok ? 'Free trial' : 'No active plan'}</span>;");
    expect(out).toContain('__opT("Free trial")');
    expect(out).toContain('__opT("No active plan")');
    expect(out).toMatch(/\?[\s\S]*:/); // 三元结构保留
  });

  it('JSX children 逻辑 &&：字符串后缀被包 __opT（前导空白经规范化）', () => {
    const out = rw("const x = <span>Showing {n} {trunc && ' (truncated)'}</span>;");
    expect(out).toContain('__opT("(truncated)")');
  });

  it('toast 三元实参：两个分支都被包 __opT', () => {
    const out = rw("toast.success(enabled ? 'Widget enabled' : 'Widget disabled');");
    expect(out).toContain('__opT("Widget enabled")');
    expect(out).toContain('__opT("Widget disabled")');
  });

  it('白名单对象属性三元值：两个分支都被包 __opT', () => {
    const out = rw("const m = { description: paid ? 'Active plan' : 'No plan' };");
    expect(out).toContain('__opT("Active plan")');
    expect(out).toContain('__opT("No plan")');
  });

  it('混排文本 + 条件字符串：整句 __opTx，分支 __opT（同源产出一致的 msgid 集合）', () => {
    const out = rw("const x = <div>Status: {ok ? 'Up' : 'Down'}</div>;");
    expect(out).toContain('__opTx("Status: {0}"');
    expect(out).toContain('__opT("Up")');
    expect(out).toContain('__opT("Down")');
  });

  it('collectValueStringLeaves：extract 与 rewrite 共用的叶子枚举（同源保证）', () => {
    const leaves = (src: string) =>
      collectValueStringLeaves(parseExpression(src)).map((n: any) =>
        n.type === 'StringLiteral' ? n.value : n.quasis?.[0]?.value?.cooked,
      );
    expect(leaves("ok ? 'A' : 'B'")).toEqual(['A', 'B']);
    expect(leaves("flag && 'X'")).toEqual(['X']);
    expect(leaves("a ? 'A' : (b ? 'B' : 'C')")).toEqual(['A', 'B', 'C']);
    expect(leaves('someVar')).toEqual([]); // 标识符不抽
    expect(leaves('fn()')).toEqual([]); // 调用不抽
  });
});
