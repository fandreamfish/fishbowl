import fs from 'node:fs'
import zlib from 'node:zlib'
const p = process.argv[2]
const buf = fs.readFileSync(p)
const magic = Buffer.from([0x28,0xb5,0x2f,0xfd])
const starts=[];let i=0
while(true){const k=buf.indexOf(magic,i);if(k<0)break;starts.push(k);i=k+4}
let text='';let ok=0,bad=0
for(let n=0;n<starts.length;n++){const end=n+1<starts.length?starts[n+1]:buf.length;try{text+=zlib.zstdDecompressSync(buf.subarray(starts[n],end)).toString('utf8');ok++}catch{bad++}}
const lines=text.split(/\r?\n/).filter(Boolean)
let parsed=0,broken=0,last=''
for(const l of lines){try{const e=JSON.parse(l);parsed++;last=e.type}catch{broken++}}
console.log({bytes:buf.length,frames:starts.length,ok,bad,lines:lines.length,parsed,broken,last})
