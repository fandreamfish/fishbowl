const fs = require('node:fs')
const path = 'S:/DeepSeek Harness/resources/app.asar'
const fd = fs.openSync(path, 'r')
const head = Buffer.alloc(16)
fs.readSync(fd, head, 0, 16, 0)
const headerSize = head.readUInt32LE(12)
const jsonBuf = Buffer.alloc(headerSize)
fs.readSync(fd, jsonBuf, 0, headerSize, 16)
const header = JSON.parse(jsonBuf.toString('utf8').replace(/\u0000+$/g, '').trimEnd())
const dataStart = 16 + Math.ceil(headerSize / 4) * 4
function walk(node, prefix) {
  const out = []
  if (node.files) for (const [k, v] of Object.entries(node.files)) out.push(...walk(v, prefix ? prefix + '/' + k : k))
  else out.push({ path: prefix, offset: Number(node.offset), size: Number(node.size) })
  return out
}
const files = walk(header, '')
const find = (suffix) => files.filter(f => f.path.endsWith(suffix))
for (const s of ['@deepseek-ai/dsh/package.json', '@deepseek-ai/dsh-base/package.json', '@deepseek-ai/dsh-session/package.json']) {
  const hit = find(s)[0]
  if (!hit) { console.log(s, 'NOT FOUND'); continue }
  const b = Buffer.alloc(hit.size)
  fs.readSync(fd, b, 0, hit.size, dataStart + hit.offset)
  const j = JSON.parse(b.toString('utf8'))
  console.log(j.name, j.version)
}
