const fs = require('node:fs')
const zlib = require('node:zlib')
const p = process.argv[2]
const buf = fs.readFileSync(p)
// 按 zstd 魔数切帧
const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const starts = []
for (let i = 0; i + 4 <= buf.length; i++) {
  if (buf[i] === 0x28 && buf[i+1] === 0xb5 && buf[i+2] === 0x2f && buf[i+3] === 0xfd) starts.push(i)
}
let text = ''
for (let k = 0; k < starts.length; k++) {
  const s = starts[k]
  const e = k + 1 < starts.length ? starts[k+1] : buf.length
  try { text += zlib.zstdDecompressSync(buf.subarray(s, e)).toString('utf8') } catch (err) { /* 跳坏帧 */ }
}
const lines = text.split('\n').filter(l => l.trim())
console.log('frames', starts.length, 'lines', lines.length)
const msgs = []
for (const l of lines) {
  try {
    const ev = JSON.parse(l)
    if (ev.type === 'assistant/message' || ev.type === 'user/message') {
      const m = ev.data?.message ?? ev.data
      const c = Array.isArray(m?.content) ? m.content.map(b => b?.text || '').join('') : (typeof m?.content === 'string' ? m.content : '')
      msgs.push({ type: ev.type, role: m?.role, src: m?.source?.kind, len: c.length, c })
    }
  } catch {}
}
const a = msgs.filter(m => m.type === 'assistant/message')
console.log('assistant msgs:', a.length)
console.log('lengths:', a.map(m => m.len).join(', '))
const last = a.slice(-3)
for (const m of last) { console.log('==== len', m.len, '===='); console.log(m.c.slice(0, 600)) }
