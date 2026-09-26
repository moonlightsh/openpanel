// vite-plugin-op-i18n 提取器（review 版）
// 依据设计 §5：提取与改写共用同一规则；本文件仅做提取用于生成对照表。
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import {
  ATTR_WHITELIST, OBJ_KEY_WHITELIST, ZOD_METHODS,
  normalize, isRejected, 
  tagName, isStrLit, tplNoExpr, tplToMsg, hasRejectAncestor, mergeChildren,
  REJECT_TAGS, REJECT_COMPONENT,
} from '../shared/rules.mjs';

const traverse = _traverse.default || _traverse;
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..', '..', '..');           // packages/i18n-zh/cli -> repo root
const SRC = join(REPO, 'apps', 'start', 'src');
const OUT = join(__dirname, '..', 'catalog', 'en.json');

const catalog = new Map(); // msgid -> {count, refs:Set, kinds:Set}
function add(msgid, kind, file, line) {
  const id = normalize(msgid);
  if (!id || isRejected(id)) { return; }
  let e = catalog.get(id);
  if (!e) { e = { count: 0, refs: new Set(), kinds: new Set() }; catalog.set(id, e); }
  e.count++;
  if (e.refs.size < 5) { e.refs.add(`${file}:${line}`); }
  e.kinds.add(kind);
}

// ---- 文件遍历 ----
function walk(dir, acc){
  for (const name of readdirSync(dir)){
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()){ if (name === 'node_modules') { continue;  }walk(full, acc); }
    else if (/\.(ts|tsx)$/.test(name)){
      if (/\.(test|spec)\.(ts|tsx)$/.test(name)) { continue; }
      if (/\.gen\.ts$/.test(name)) { continue; }
      if (name === 'routeTree.gen.ts') { continue; }
      acc.push(full);
    }
  }
}

const files = [];
walk(SRC, files);
let parseErrors = 0;

for (const file of files){
  const rel = relative(join(REPO,'apps','start'), file);
  let ast;
  try {
    ast = parse(readFileSync(file,'utf8'), {
      sourceType:'module',
      plugins:['typescript','jsx','decorators-legacy','importAttributes','explicitResourceManagement'],
    });
  } catch(_err){ parseErrors++; continue; }

  traverse(ast, {
    JSXElement(path){
      const t = tagName(path.node);
      if (REJECT_TAGS.test(t) || REJECT_COMPONENT.test(t)) { return; }
      if (hasRejectAncestor(path)) { return; }
      const msg = mergeChildren(path.node.children);
      if (msg != null) { add(msg, 'jsx', rel, path.node.loc?.start.line ?? 0); }
    },
    JSXFragment(path){
      if (hasRejectAncestor(path)) { return; }
      const msg = mergeChildren(path.node.children);
      if (msg != null) { add(msg, 'jsx', rel, path.node.loc?.start.line ?? 0); }
    },
    JSXAttribute(path){
      const nm = path.node.name;
      const name = nm.type === 'JSXIdentifier' ? nm.name
        : nm.type === 'JSXNamespacedName' ? `${nm.namespace.name}:${nm.name.name}` : '';
      if (!ATTR_WHITELIST.has(name)) { return; }
      const v = path.node.value;
      if (!v) { return; }
      const line = path.node.loc?.start.line ?? 0;
      if (isStrLit(v)) { add(v.value, 'attr', rel, line); }
      else if (v.type === 'JSXExpressionContainer'){
        const e = v.expression;
        if (isStrLit(e)) { add(e.value, 'attr', rel, line); }
        else if (tplNoExpr(e)) { add(e.quasis[0].value.cooked ?? '', 'attr', rel, line); }
        else if (e && e.type === 'TemplateLiteral') { add(tplToMsg(e), 'attr', rel, line); }
      }
    },
    CallExpression(path){
      const callee = path.node.callee;
      const line = path.node.loc?.start.line ?? 0;
      // toast.*(...) 与 toast(...)
      let isToast = false;
      if (callee.type === 'MemberExpression' && callee.object?.type === 'Identifier' && callee.object.name === 'toast') { isToast = true; }
      if (callee.type === 'Identifier' && callee.name === 'toast') { isToast = true; }
      if (isToast){
        for (const arg of path.node.arguments){
          if (isStrLit(arg)) { add(arg.value, 'toast', rel, line); }
          else if (tplNoExpr(arg)) { add(arg.quasis[0].value.cooked ?? '', 'toast', rel, line); }
          else if (arg.type === 'TemplateLiteral') { add(tplToMsg(arg), 'toast', rel, line); }
        }
      }
      // zod: .min/.max/.email/.url/.regex/.refine/... 的字符串参数与 {message}
      if (callee.type === 'MemberExpression' && callee.property?.type === 'Identifier' && ZOD_METHODS.has(callee.property.name)){
        for (const arg of path.node.arguments){
          if (isStrLit(arg)) { add(arg.value, 'zod', rel, line); }
          else if (tplNoExpr(arg)) { add(arg.quasis[0].value.cooked ?? '', 'zod', rel, line); }
          else if (arg.type === 'ObjectExpression'){
            for (const p of arg.properties){
              if (p.type === 'ObjectProperty' && !p.computed){
                const k = p.key.type === 'Identifier' ? p.key.name : (p.key.type==='StringLiteral'?p.key.value:'');
                if (k === 'message'){
                  if (isStrLit(p.value)) { add(p.value.value, 'zod', rel, line); }
                  else if (tplNoExpr(p.value)) { add(p.value.quasis[0].value.cooked ?? '', 'zod', rel, line); }
                }
              }
            }
          }
        }
      }
    },
    ObjectProperty(path){
      const node = path.node;
      if (node.computed) { return; }
      const k = node.key.type === 'Identifier' ? node.key.name : (node.key.type==='StringLiteral'?node.key.value:'');
      if (!OBJ_KEY_WHITELIST.has(k)) { return; }
      const line = node.loc?.start.line ?? 0;
      const v = node.value;
      if (isStrLit(v)) { add(v.value, 'object', rel, line); }
      else if (tplNoExpr(v)) { add(v.quasis[0].value.cooked ?? '', 'object', rel, line); }
    },
  });
}

// ---- 输出 catalog（按 count 降序、msgid 升序，确定性）----
const entries = [...catalog.entries()].sort((a,b)=> b[1].count - a[1].count || a[0].localeCompare(b[0]));
const obj = {};
for (const [msgid, e] of entries){
  obj[msgid] = { count: e.count, kinds: [...e.kinds].sort(), refs: [...e.refs] };
}
mkdirSync(dirname(OUT), { recursive:true });
writeFileSync(OUT, `${JSON.stringify(obj, null, 2)}\n`);

// 汇总到 stderr
const byKind = {};
for (const e of catalog.values()) { for (const k of e.kinds) { byKind[k] = (byKind[k]||0)+1; } }
console.error(`files=${files.length} parseErrors=${parseErrors} uniqueMsgids=${catalog.size}`);
console.error(`byKind(唯一词条命中的来源类别，可重叠): ${JSON.stringify(byKind)}`);
console.error(`catalog -> ${relative(REPO, OUT)}`);
