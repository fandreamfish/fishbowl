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
const lines = text.split('\n').filter(l => l.trim())
let injected = 0
for (const l of lines) {
  try {
    const ev = JSON.parse(l)
    if (ev.type === 'user/message') {
      const m = ev.data?.message ?? ev.data
      if (m?.source?.kind === 'fishbowl') {
        injected++
        const t = new Date(ev.ts ?? ev.time ?? 0).toISOString()
        const c = (Array.isArray(m.content) ? m.content.map(b=>b.text||'').join('') : String(m.content||''))
        console.log('---', t, 'len', c.length)
        console.log(c.slice(0, 120).replace(/\n/g, ' | '))
      }
    }
  } catch {}
}
console.log('fishbowl 注入条数:', injected, '事件总数:', lines.length)
