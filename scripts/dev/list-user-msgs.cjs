const fs=require('node:fs'),z=require('node:zlib')
const buf=fs.readFileSync(process.argv[2])
const magic=Buffer.from([0x28,0xb5,0x2f,0xfd])
const starts=[];let i=0
while(true){const k=buf.indexOf(magic,i);if(k<0)break;starts.push(k);i=k+4}
let text=''
for(let n=0;n<starts.length;n++){const end=n+1<starts.length?starts[n+1]:buf.length;try{text+=z.zstdDecompressSync(buf.subarray(starts[n],end)).toString('utf8')}catch{}}
let n=0
for(const l of text.split(/\r?\n/).filter(Boolean)){let e;try{e=JSON.parse(l)}catch{continue}
 if(e.type!=='user/message') continue
 const c=e.data?.content??[]; const s=c.map(x=>x.text||'').join('\n')
 n++
 console.log('U'+n+' ['+(e.time?new Date(e.time).toLocaleTimeString('zh-CN'):'')+'] '+s.slice(0,90).replace(/\n/g,' / '))
}
