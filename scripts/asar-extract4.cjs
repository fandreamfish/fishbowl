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
const w = 'dsh/node_modules/@deepseek-ai/dsh-agent/lib/types/index.js'
const hit = files.find(f => f.path === w)
const b = Buffer.alloc(hit.size)
fs.readSync(fd, b, 0, hit.size, dataStart + hit.offset)
fs.writeFileSync(path.join(outDir, 'agent-types-index.js'), b)
console.log('OK', b.length)
