const fs = require('node:fs')
const z = require('node:zlib')
const p = process.argv[2]
const buf = fs.readFileSync(p)
const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const starts = []
let i = 0
while (true) { const k = buf.indexOf(magic, i); if (k < 0) break; starts.push(k); i = k + 4 }
const out = []
for (let n = 0; n < starts.length; n++) {
  const end = n + 1 < starts.length ? starts[n + 1] : buf.length
  try { out.push(z.zstdDecompressSync(buf.subarray(starts[n], end)).toString('utf8')) } catch (e) { /* skip */ }
}
const text = out.join('')
const lines = text.split(/\r?\n/).filter(Boolean)
console.log('frames', starts.length, 'lines', lines.length)
for (const line of lines) {
  let e; try { e = JSON.parse(line) } catch { continue }
  const t = e.type
  const d = e.data ?? e
  if (t === 'session' || t === 'session/header') continue
  const role = d.role ?? d.message?.role ?? ''
  const content = d.content ?? d.message?.content ?? d.text ?? ''
  const s = typeof content === 'string' ? content : JSON.stringify(content)
  if (/message/.test(String(t)) || role) console.log('---', t, role, s.slice(0, 700))
}
