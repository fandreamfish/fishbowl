import fs from 'node:fs'; import zlib from 'node:zlib'
const p=process.argv[2]; const buf=fs.readFileSync(p); const magic=Buffer.from([0x28,0xb5,0x2f,0xfd]); let i=0,t=''
while(true){const k=buf.indexOf(magic,i); if(k<0)break; let n=buf.indexOf(magic,k+4); if(n<0)n=buf.length; try{t+=zlib.zstdDecompressSync(buf.subarray(k,n)).toString('utf8')}catch{}; i=k+4}
const c={}; for(const l of t.split(/\r?\n/).filter(Boolean)){try{const e=JSON.parse(l); c[e.type]=(c[e.type]||0)+1}catch{}}
console.log(c)
