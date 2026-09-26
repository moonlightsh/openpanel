import { describe, expect, it } from 'vitest';
import { buildNodes, extraPlaceholders, fmt, placeholderSet } from '../shared/runtime-core.mjs';

describe('fmt — 值插值', () => {
  it('按索引替换', () => {
    expect(fmt('显示 {0} 项', [5])).toBe('显示 5 项');
  });
  it('允许重排', () => {
    expect(fmt('显示 {1} 中的 {0}', ['a', 'b'])).toBe('显示 b 中的 a');
  });
  it('允许译文省略占位符（多余实参被忽略）', () => {
    expect(fmt('你好', ['x', 'y'])).toBe('你好');
  });
  it('null 实参替换为空串', () => {
    expect(fmt('值 {0}', [null])).toBe('值 ');
  });
  it('越界（缺参）保留占位符字面，暴露字典缺陷而非产出垃圾', () => {
    expect(fmt('值 {0}', [])).toBe('值 {0}');
  });
});

describe('buildNodes — 元素插值', () => {
  it('拆分为节点数组', () => {
    expect(buildNodes('A {0} B', ['X'])).toEqual(['A ', 'X', ' B']);
  });
  it('支持重排', () => {
    expect(buildNodes('{1}-{0}', ['a', 'b'])).toEqual(['b', '-', 'a']);
  });
  it('越界跳过，不 push undefined', () => {
    const nodes = buildNodes('A {0}', []);
    expect(nodes).toEqual(['A ']);
    expect(nodes.some((n) => n === undefined)).toBe(false);
  });
  it('false/null 作为 part 被保留（React 会正确渲染为空）', () => {
    expect(buildNodes('{0}', [false])).toEqual([false]);
    expect(buildNodes('{0}', [null])).toEqual([null]);
  });
});

describe('extraPlaceholders — 占位符门禁', () => {
  it('译文占位符是原文子集时合法（无多出）', () => {
    expect(extraPlaceholders('a {0} {1}', 'b {1} {0}')).toEqual([]); // 重排
    expect(extraPlaceholders('a {0} {1}', 'b {0}')).toEqual([]); // 省略
    expect(extraPlaceholders('a {0}', 'b {0} {0}')).toEqual([]); // 重复
  });
  it('译文多出原文没有的占位符 -> 非法', () => {
    expect(extraPlaceholders('a {0}', 'b {0} {1}')).toEqual([1]);
    expect(extraPlaceholders('无占位', '{0}')).toEqual([0]);
  });
  it('placeholderSet 提取全部索引', () => {
    expect([...placeholderSet('x {0} y {2} z {0}')].sort()).toEqual([0, 2]);
  });
});
