// shared/rules.mjs 的类型声明（提取与改写共用规则；AST 相关一律 any）。
export const ATTR_WHITELIST: Set<string>;
export const OBJ_KEY_WHITELIST: Set<string>;
export const ZOD_METHODS: Set<string>;
export const REJECT_TAGS: RegExp;
export const REJECT_COMPONENT: RegExp;
export const SHARED_UI_FILES: string[];
export function shouldTranslateFile(rawPath: string): boolean;
export const CODE_FORM: RegExp;
export const URL_FORM: RegExp;
export function normalize(raw: string): string;
export function stripPlaceholders(s: string): string;
export function isRejected(msgid: string): boolean;
export function tagName(node: any): string;
export function isStrLit(n: any): boolean;
export function tplNoExpr(n: any): boolean;
export function tplToMsg(n: any): string;
export function hasRejectAncestor(path: any): boolean;
export function collectChildren(children: any[]): {
  raw: string;
  dynamics: Array<{ kind: 'expr' | 'element'; node: any }>;
  hasElement: boolean;
  hasTextLetters: boolean;
};
export function mergeChildren(children: any[]): string | null;
