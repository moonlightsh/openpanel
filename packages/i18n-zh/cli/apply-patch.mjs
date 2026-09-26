import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const D = dirname(fileURLToPath(import.meta.url));
const CAT = join(D,'..','catalog');
function readText(p){
  try { return readFileSync(p,'utf8'); }
  catch (e) { throw new Error(`读取失败 ${p}: ${e instanceof Error ? e.message : e}`); }
}
const patch = new Map();
for (const line of readText(join(CAT,'_patch_s3.tsv')).split('\n')){
  if(!line.trim()) { continue;  }const i=line.indexOf('|||');
  patch.set(Number(line.slice(0,i)), line.slice(i+3));
}
const applied = new Set();
for (const f of ['_zh_1.tsv','_zh_2.tsv','_zh_3.tsv','_zh_4.tsv']){
  const p = join(CAT,f);
  const out = readText(p).split('\n').map(line=>{
    if(!line.trim()) { return line;  }const i=line.indexOf('|||'); const idx=Number(line.slice(0,i));
    if (patch.has(idx)){ applied.add(idx); return `${idx}|||${patch.get(idx)}`; }
    return line;
  }).join('\n');
  writeFileSync(p, out);
}
const missed = [...patch.keys()].filter(k=>!applied.has(k));
console.log('patch total:', patch.size, ' applied:', applied.size, ' missed:', missed.length?missed.join(','):'none');
