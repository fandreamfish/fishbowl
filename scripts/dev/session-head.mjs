import fs from 'node:fs'; import zlib from 'node:zlib'
const buf=fs.readFileSync(process.argv[2]); const magic=Buffer.from([0x28,0xb5,0x2f,0xfd]); const k=buf.indexOf(magic); let n=buf.indexOf(magic,k+4); if(n<0)n=buf.length
const t=zlib.zstdDecompressSync(buf.subarray(k,n)).toString('utf8')
for(const l of t.split(/\r?\n/).filter(Boolean).slice(0,4)){const e=JSON.parse(l); console.log(e.type, e.data?Object.keys(e.data).slice(0,6):'')}
