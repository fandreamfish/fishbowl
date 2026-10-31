const fs = require('node:fs')
const path = require('node:path')
const asarPath = 'S:/DeepSeek Harness/resources/app.asar'
const outDir = '.inspect/rc5/pkgs'
fs.mkdirSync(outDir, { recursive: true })
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
const re = /^dsh\/node_modules\/@deepseek-ai\/(dsh-[^/]+)\/lib\/index\.js$/
let n = 0
for (const f of files) {
  const m = f.path.match(re)
  if (!m) continue
  const b = Buffer.alloc(f.size)
  fs.readSync(fd, b, 0, f.size, dataStart + f.offset)
  const name = m[1] + '.js'
  fs.writeFileSync(path.join(outDir, name), b)
  n++
}
console.log('extracted', n)
