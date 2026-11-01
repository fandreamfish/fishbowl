const fs = require('node:fs')
const z = require('node:zlib')
const p = process.argv[2]
const buf = fs.readFileSync(p)
const magic = Buffer.from([0x28,0xb5,0x2f,0xfd])
const starts=[]; let i=0
while(true){const k=buf.indexOf(magic,i); if(k<0)break; starts.push(k); i=k+4}
let text=''
for(let n=0;n<starts.length;n++){const end=n+1<starts.length?starts[n+1]:buf.length; try{text+=z.zstdDecompressSync(buf.subarray(starts[n],end)).toString('utf8')}catch{}}
const lines=text.split(/\r?\n/).filter(Boolean)
const counts={}
for(const l of lines){let e;try{e=JSON.parse(l)}catch{continue}; counts[e.type]=(counts[e.type]||0)+1}
console.log(counts)
for(const l of lines){let e;try{e=JSON.parse(l)}catch{continue}
  if(e.type==='agent/preset'||e.type==='session/header'||String(e.type).includes('preset')) console.log('EVT', l.slice(0,500))
}
