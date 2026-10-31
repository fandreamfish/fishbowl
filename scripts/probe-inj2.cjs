const fs = require('node:fs')
const zlib = require('node:zlib')
const buf = fs.readFileSync(process.argv[2])
const starts = []
for (let i = 0; i + 4 <= buf.length; i++) if (buf[i]===0x28&&buf[i+1]===0xb5&&buf[i+2]===0x2f&&buf[i+3]===0xfd) starts.push(i)
let text = ''
for (let k = 0; k < starts.length; k++) {
  const s = starts[k], e = k+1 < starts.length ? starts[k+1] : buf.length
  try { text += zlib.zstdDecompressSync(buf.subarray(s, e)).toString('utf8') } catch {}
}
const idx = text.indexOf('fishbowl')
console.log('出现位置:', idx)
if (idx >= 0) console.log(text.slice(Math.max(0, idx - 400), idx + 400))
else {
  // 看事件类型分布
  const types = {}
  for (const l of text.split('\n')) {
    try { const e = JSON.parse(l); types[e.type] = (types[e.type]||0)+1 } catch {}
  }
  console.log('事件类型:', JSON.stringify(types))
}
