const fs = require('node:fs')
const zlib = require('node:zlib')
const path = require('node:path')
const root = process.argv[2]
function decode(file) {
  const buf = fs.readFileSync(file)
  const starts = []
  for (let i = 0; i + 4 <= buf.length; i++) if (buf[i]===0x28&&buf[i+1]===0xb5&&buf[i+2]===0x2f&&buf[i+3]===0xfd) starts.push(i)
  let text = ''
  for (let k = 0; k < starts.length; k++) {
    const s = starts[k], e = k+1 < starts.length ? starts[k+1] : buf.length
    try { text += zlib.zstdDecompressSync(buf.subarray(s, e)).toString('utf8') } catch {}
  }
  return text
}
for (const d of fs.readdirSync(root)) {
  const dd = path.join(root, d)
  if (!fs.statSync(dd).isDirectory()) continue
  for (const sd of fs.readdirSync(dd)) {
    const sdir = path.join(dd, sd)
    if (!fs.statSync(sdir).isDirectory()) continue
    for (const f of fs.readdirSync(sdir)) {
      if (!f.endsWith('.zstd')) continue
      let text
      try { text = decode(path.join(sdir, f)) } catch { continue }
      if (!text.includes('fishbowl 状态')) continue
      // 找无名字的注入（紧跟在 [fishbowl 状态]\n 后就是 情绪:）
      const re = /\[fishbowl 状态\]\\n情绪:/g
      const m = text.match(re)
      if (m) console.log(sd, '中性注入次数:', m.length)
    }
  }
}
