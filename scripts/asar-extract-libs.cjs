const fs = require('node:fs')
const path = require('node:path')
const asarPath = 'S:/DeepSeek Harness/resources/app.asar'
const outDir = 'D:/fish-memory/.inspect/rc5'
const fd = fs.openSync(asarPath, 'r')
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
const want = [
  'dsh/node_modules/@deepseek-ai/dsh-session/lib/index.js',
  'dsh/node_modules/@deepseek-ai/dsh-agent/lib/index.js',
  'dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js',
  'dsh/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js',
  'dsh/node_modules/@deepseek-ai/dsh-web-app/lib/index.js',
]
for (const w of want) {
  const hit = files.find(f => f.path === w)
  if (!hit) { console.log('MISS', w); continue }
  const b = Buffer.alloc(hit.size)
  fs.readSync(fd, b, 0, hit.size, dataStart + hit.offset)
  const name = w.split('/').slice(3, 5).join('-') + '.js'
  fs.writeFileSync(path.join(outDir, name), b)
  console.log('OK', name, b.length)
}
