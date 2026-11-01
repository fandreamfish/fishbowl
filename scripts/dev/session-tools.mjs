import fs from 'node:fs'; import zlib from 'node:zlib'
const buf=fs.readFileSync(process.argv[2]); const magic=Buffer.from([0x28,0xb5,0x2f,0xfd]); let i=0,t=''
while(true){const k=buf.indexOf(magic,i); if(k<0)break; let n=buf.indexOf(magic,k+4); if(n<0)n=buf.length; try{t+=zlib.zstdDecompressSync(buf.subarray(k,n)).toString('utf8')}catch{}; i=k+4}
for(const l of t.split(/\r?\n/).filter(Boolean)){let e;try{e=JSON.parse(l)}catch{continue}; if(e.type==='tool/call'){const d=e.data||{}; console.log(d.name, String(d.arguments||'').slice(0,200))}}
