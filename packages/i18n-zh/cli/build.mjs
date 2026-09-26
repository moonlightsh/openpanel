import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extraPlaceholders } from '../shared/runtime-core.mjs';
const D = dirname(fileURLToPath(import.meta.url));
const CAT = join(D,'..','catalog');
const LOC = join(D,'..','locales');
// F5：受控读取，失败时带文件名上下文（pi-lens 约定）
function readText(p){
  try { return readFileSync(p,'utf8'); }
  catch (e) { throw new Error(`读取失败 ${p}: ${e instanceof Error ? e.message : e}`); }
}

const inv = new Map();
// _inventory.tsv 为原始冻结清单(1..1344)；_inventory_delta.tsv 为统一范围重提后新增的
// 词条(1345+，含 packages/constants 与 apps/start 模板串)。两者索引连续，共同驱动 build。
for (const invFile of ['_inventory.tsv','_inventory_delta.tsv']){
  let raw = '';
  try { raw = readText(join(CAT,invFile)); }
  catch (e) { if (invFile === '_inventory_delta.tsv') { continue; } throw e; }
  for (const line of raw.split('\n')){
    if(!line.trim()) { continue; }
    const [idx,count,kinds,enJson] = line.split('\t');
    let en; try{ en=JSON.parse(enJson);}catch{ throw new Error(`bad line ${line}`);}
    inv.set(Number(idx), { en, count:Number(count), kinds });
  }
}
const zh = new Map();
for (const f of ['_zh_1.tsv','_zh_2.tsv','_zh_3.tsv','_zh_4.tsv','_zh_5.tsv','_zh_6.tsv','_zh_7.tsv','_zh_8.tsv','_zh_9.tsv','_zh_10.tsv','_zh_11.tsv']){
  for (const line of readText(join(CAT,f)).split('\n')){
    if(!line.trim()) { continue; }
    const i=line.indexOf('|||'); zh.set(Number(line.slice(0,i)), line.slice(i+3));
  }
}
// 分类输出
const dict = {}; const rejects = []; const rows = [];
for (let i=1;i<=inv.size;i++){
  const {en,count,kinds} = inv.get(i); const cn = zh.get(i) ?? '';
  const isReject = cn.startsWith('⟨不翻译');
  let note = '';
  if (isReject){ note = cn.replace(/^⟨不翻译:?/,'').replace(/⟩$/,''); rejects.push({en,reason:note,kinds}); }
  else if (cn !== '') { dict[en] = cn; }  // F1：空译文不入字典 -> 运行时回退英文原文（而非空白）
  rows.push({ i, en, cn: isReject? '' : cn, count, kinds, note, ref: (inv.get(i).ref||'') });
}
// F4：占位符完整性门禁 —— 译文占位符必须是原文的子集（允许重排/省略；多出即非法）
const phViolations = [];
for (let i=1;i<=inv.size;i++){
  const cn = zh.get(i);
  if (!cn || cn.startsWith('⟨不翻译')) { continue; }
  const extra = extraPlaceholders(inv.get(i).en, cn);
  if (extra.length) { phViolations.push({ i, en: inv.get(i).en, cn, extra }); }
}
if (phViolations.length){
  for (const v of phViolations) { console.error(`  #${v.i} 多出占位符 {${v.extra.join('},{')}}  ${JSON.stringify(v.en.slice(0,40))} | ${JSON.stringify(v.cn.slice(0,40))}`); }
  throw new Error(`占位符完整性校验失败：${phViolations.length} 条译文含原文没有的占位符`);
}
// zh-CN.json（拒结项不入字典 -> 运行时回退英文原文）
writeFileSync(join(LOC,'zh-CN.json'), `${JSON.stringify(dict, null, 2)}\n`);
writeFileSync(join(CAT,'reject.json'), `${JSON.stringify(rejects, null, 2)}\n`);

// 审核 CSV（UTF-8 BOM，Excel 友好）
const esc = s => `"${String(s).replace(/"/g,'""')}"`;
// 附上示例位置（从 en.json 取第一个 ref）
let enCat = {}; try { enCat = JSON.parse(readText(join(CAT,'en.json'))); } catch { enCat = {}; }
let csv = '\uFEFF序号,英文原文,建议中文,出现次数,来源,示例位置,备注\n';
for (const r of rows){
  const ref = (enCat[r.en]?.refs?.[0]) || '';
  csv += `${[r.i, esc(r.en), esc(r.cn), r.count, esc(r.kinds), esc(ref), esc(r.note)].join(',')}\n`;
}
writeFileSync(join(CAT,'对照表.csv'), csv);

console.log('translated(entering dict):', Object.keys(dict).length);
console.log('rejects(不翻译):', rejects.length);
console.log('rows total:', rows.length);
// 对齐抽检：随机若干无占位符条目，打印 英文 | 中文
const samples = [50,150,300,450,600,750,900,1000,1100,1200];
console.log('\n=== 对齐抽检（英文 || 中文）===');
for (const s of samples){ const e=inv.get(s); console.log(`#${s}  ${JSON.stringify(e.en)}  ||  ${zh.get(s)}`); }
