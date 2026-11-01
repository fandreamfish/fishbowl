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
for(const l of lines){
  let e; try{e=JSON.parse(l)}catch{continue}
  const t=e.type
  if(!/message|tool/.test(t)) continue
  const d=e.data??{}
  if(t==='system/message') continue
  if(t==='tool/call'){ console.log('CALL', d.name, JSON.stringify(d.arguments??d.args??'').slice(0,200)); continue }
  if(t==='tool/result'){ console.log('RES ', JSON.stringify(d).slice(0,300)); continue }
  const role=d.role??''
  const c=d.content??d.text??''
  const s=typeof c==='string'?c:JSON.stringify(c)
  console.log('MSG', role, s.slice(0,400))
}
