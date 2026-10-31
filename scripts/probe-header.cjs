const fs = require('node:fs')
const zlib = require('node:zlib')
const p = process.argv[2]
const buf = fs.readFileSync(p)
const starts = []
for (let i = 0; i + 4 <= buf.length; i++) if (buf[i]===0x28&&buf[i+1]===0xb5&&buf[i+2]===0x2f&&buf[i+3]===0xfd) starts.push(i)
let text = ''
for (let k = 0; k < starts.length; k++) {
  const s = starts[k], e = k+1 < starts.length ? starts[k+1] : buf.length
  try { text += zlib.zstdDecompressSync(buf.subarray(s, e)).toString('utf8') } catch {}
}
const first = text.split('\n').find(Boolean)
console.log(first)
