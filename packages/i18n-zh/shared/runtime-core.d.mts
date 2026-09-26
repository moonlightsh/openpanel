// 类型声明：见 shared/runtime-core.mjs（运行时纯函数单一源）。
export function fmt(text: string, args: unknown[]): string;
export function buildNodes(text: string, parts: unknown[]): unknown[];
export function placeholderSet(s: string): Set<number>;
export function extraPlaceholders(en: string, cn: string): number[];
