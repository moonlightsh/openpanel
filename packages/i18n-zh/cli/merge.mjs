import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const D = dirname(fileURLToPath(import.meta.url));
const CAT = join(D,'..','catalog');
function readText(p){
  try { return readFileSync(p,'utf8'); }
  catch (e) { throw new Error(`读取失败 ${p}: ${e instanceof Error ? e.message : e}`); }
}
const inv = new Map();     // idx -> {en, count, kinds}
for (const invFile of ['_inventory.tsv','_inventory_delta.tsv']){
  let raw = '';
  try { raw = readText(join(CAT,invFile)); }
  catch (e) { if (invFile === '_inventory_delta.tsv') { continue; } throw e; }
  for (const line of raw.split('\n')){
    if(!line.trim()) { continue; }
    const [idx,count,kinds,enJson] = line.split('\t');
    let en;
    try { en = JSON.parse(enJson); } catch { throw new Error(`bad inventory line: ${line}`); }
    inv.set(Number(idx), { en, count:Number(count), kinds });
  }
}
const zh = new Map(); const dupes=[];
for (const f of ['_zh_1.tsv','_zh_2.tsv','_zh_3.tsv','_zh_4.tsv','_zh_5.tsv','_zh_6.tsv','_zh_7.tsv','_zh_8.tsv','_zh_9.tsv','_zh_10.tsv','_zh_11.tsv']){
  for (const line of readText(join(CAT,f)).split('\n')){
    if(!line.trim()) { continue; }
    const i = line.indexOf('|||');
    const idx = Number(line.slice(0,i)); const val = line.slice(i+3);
    if (zh.has(idx)) { dupes.push(idx); }
    zh.set(idx, val);
  }
}
const phArr = s => (s.match(/\{\d+\}/g)||[]);
const missing=[];
const phExtra=[];
const phDropped=[];
for (let i=1;i<=inv.size;i++){
  if(!zh.has(i)){ missing.push(i); continue; }
  const en=inv.get(i).en;
  const cn=zh.get(i);
  if (cn.startsWith('⟨不翻译')) { continue; }
  const enP = new Set(phArr(en));
  const cnP = new Set(phArr(cn));
  const extra = [...cnP].filter(x=>!enP.has(x));    // 中文多出英文没有的占位符 -> 真 bug
  const dropped = [...enP].filter(x=>!cnP.has(x));   // 中文少了(如英文复数后缀) -> 允许,仅记录
  if (extra.length) { phExtra.push({i,en,cn,extra:extra.join(',')}); }
  if (dropped.length) { phDropped.push({i,en:en.slice(0,40),dropped:dropped.join(',')}); }
}
console.log('inventory size:', inv.size, ' zh size:', zh.size);
console.log('dupes:', dupes.length?dupes.join(','):'none');
console.log('missing indices:', missing.length?missing.join(','):'none');
// FIX-NOW：missing 也硬失败（与 build 一致）：每个 inventory 索引必须有译文分片
if (missing.length) { throw new Error(`有 ${missing.length} 个 inventory 索引缺译文分片（见上方 missing indices）`); }
console.log('placeholder EXTRA (中文多出,真 bug):', phExtra.length);
for(const m of phExtra.slice(0,40)) { console.log(`  #${m.i} extra[${m.extra}] "${m.en.slice(0,50)}" | "${m.cn.slice(0,40)}"`); }
console.log('placeholder dropped (中文少,允许,如复数后缀):', phDropped.length, phDropped.map(d=>`#${d.i}`).join(' '));
// F4：merge 侧也作硬门禁 —— 译文多出原文没有的占位符即失败（与 build.mjs 双路径一致）
if (phExtra.length) { throw new Error(`占位符完整性校验失败：${phExtra.length} 条译文含原文没有的占位符（见上方 #idx 明细）`); }

// 生成双语核对文件
let bi='';
for(let i=1;i<=inv.size;i++){ const e=inv.get(i); bi+=`${i}\t${e.count}\t${e.kinds}\t${JSON.stringify(e.en)}\t${zh.get(i)??'<缺失>'}\n`; }
writeFileSync(join(CAT,'_bilingual.tsv'), bi);
console.log('wrote _bilingual.tsv');
