const fs = require('node:fs'), z = require('node:zlib')
const p = process.argv[2]
const buf = fs.readFileSync(p)
const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const starts = []; let i = 0
while (true) { const k = buf.indexOf(magic, i); if (k < 0) break; starts.push(k); i = k + 4 }
let text = ''
for (let n = 0; n < starts.length; n++) {
  const end = n + 1 < starts.length ? starts[n + 1] : buf.length
  try { text += z.zstdDecompressSync(buf.subarray(starts[n], end)).toString('utf8') } catch {}
}
const counts = { target: 0, voice: 0 }
const samples = []
for (const l of text.split(/\r?\n/).filter(Boolean)) {
  let e; try { e = JSON.parse(l) } catch { continue }
  const s = JSON.stringify(e.data ?? '')
  if (s.includes('You are an AI agent powered by DeepSeek Harness')) { counts.target++; if (samples.length < 4) samples.push({ t: e.type, at: e.time ? new Date(e.time).toLocaleTimeString('zh-CN') : '' }) }
  if (s.includes('像真人，不像客服')) counts.voice++
}
console.log('counts', counts)
console.log(samples)
