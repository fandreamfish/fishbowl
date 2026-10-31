const fs = require('node:fs')
const asarPath = 'S:/DeepSeek Harness/resources/app.asar'
const fd = fs.openSync(asarPath, 'r')
const head = Buffer.alloc(16)
fs.readSync(fd, head, 0, 16, 0)
const headerSize = head.readUInt32LE(12)
const jsonBuf = Buffer.alloc(headerSize)
fs.readSync(fd, jsonBuf, 0, headerSize, 16)
const header = JSON.parse(jsonBuf.toString('utf8').replace(/\u0000+$/g, '').trimEnd())
function walk(node, prefix) {
  const out = []
  if (node.files) for (const [k, v] of Object.entries(node.files)) out.push(...walk(v, prefix ? prefix + '/' + k : k))
  else out.push(prefix)
  return out
}
const files = walk(header, '')
const pat = /session.*(persist|store|disk)|home-paths|host-webserver/i
const hits = files.filter(f => pat.test(f) && !f.includes('.pnpm') && f.endsWith('.js'))
for (const f of hits.slice(0, 30)) console.log(f)
