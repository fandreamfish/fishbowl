const fs = require('node:fs')
const z = require('node:zlib')
const p = process.argv[2]
const buf = z.zstdDecompressSync(fs.readFileSync(p))
const lines = buf.toString('utf8').split(/\r?\n/).filter(Boolean)
for (const line of lines) {
  let e
  try { e = JSON.parse(line) } catch { continue }
  const t = e.type || e.t || e.kind
  const d = e.data || e
  if (!/message|turn/.test(String(t))) continue
  const role = d.role || d.message?.role || ''
  const blocks = d.content ?? d.message?.content ?? d.text ?? ''
  const text = typeof blocks === 'string' ? blocks : JSON.stringify(blocks)
  console.log('---', t, role, String(text).slice(0, 600))
}
