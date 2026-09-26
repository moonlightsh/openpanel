import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const D = dirname(fileURLToPath(import.meta.url));
const CAT = join(D,'..','catalog');
const LOC = join(D,'..','locales');

const inv = new Map();
for (const line of readFileSync(join(CAT,'_inventory.tsv'),'utf8').split('\n')){
  if(!line.trim()) continue;
  const [idx,count,kinds,enJson] = line.split('\t');
  let en; try{ en=JSON.parse(enJson);}catch{ throw new Error('bad line '+line);}
  inv.set(Number(idx), { en, count:Number(count), kinds });
}
const zh = new Map();
for (const f of ['_zh_1.tsv','_zh_2.tsv','_zh_3.tsv','_zh_4.tsv']){
  for (const line of readFileSync(join(CAT,f),'utf8').split('\n')){
    if(!line.trim()) continue;
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
  else { dict[en] = cn; }
  rows.push({ i, en, cn: isReject? '' : cn, count, kinds, note, ref: (inv.get(i).ref||'') });
}
// zh-CN.json（拒结项不入字典 -> 运行时回退英文原文）
writeFileSync(join(LOC,'zh-CN.json'), JSON.stringify(dict, null, 2)+'\n');
writeFileSync(join(CAT,'reject.json'), JSON.stringify(rejects, null, 2)+'\n');

// 审核 CSV（UTF-8 BOM，Excel 友好）
const esc = s => '"'+String(s).replace(/"/g,'""')+'"';
// 附上示例位置（从 en.json 取第一个 ref）
let enCat = {}; try { enCat = JSON.parse(readFileSync(join(CAT,'en.json'),'utf8')); } catch { enCat = {}; }
let csv = '\uFEFF序号,英文原文,建议中文,出现次数,来源,示例位置,备注\n';
for (const r of rows){
  const ref = (enCat[r.en]?.refs?.[0]) || '';
  csv += [r.i, esc(r.en), esc(r.cn), r.count, esc(r.kinds), esc(ref), esc(r.note)].join(',')+'\n';
}
writeFileSync(join(CAT,'对照表.csv'), csv);

console.log('translated(entering dict):', Object.keys(dict).length);
console.log('rejects(不翻译):', rejects.length);
console.log('rows total:', rows.length);
// 对齐抽检：随机若干无占位符条目，打印 英文 | 中文
const samples = [50,150,300,450,600,750,900,1000,1100,1200];
console.log('\n=== 对齐抽检（英文 || 中文）===');
for (const s of samples){ const e=inv.get(s); console.log(`#${s}  ${JSON.stringify(e.en)}  ||  ${zh.get(s)}`); }
