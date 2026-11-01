const fs=require('node:fs'), z=require('node:zlib')
const buf=fs.readFileSync(process.argv[2])
const magic=Buffer.from([0x28,0xb5,0x2f,0xfd])
const starts=[];let i=0
while(true){const k=buf.indexOf(magic,i);if(k<0)break;starts.push(k);i=k+4}
let text=''
for(let n=0;n<Math.min(starts.length,60);n++){const end=n+1<starts.length?starts[n+1]:buf.length;try{text+=z.zstdDecompressSync(buf.subarray(starts[n],end)).toString('utf8')}catch{}}
const lines=text.split(/\r?\n/).filter(Boolean)
for(const l of lines){let e;try{e=JSON.parse(l)}catch{continue}
 if(/preset|permission|sandbox|approval/.test(e.type)) console.log(e.type, JSON.stringify(e.data).slice(0,200))}
