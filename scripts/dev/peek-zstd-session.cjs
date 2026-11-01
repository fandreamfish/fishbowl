const fs = require('node:fs')
const z = require('node:zlib')
const p = process.argv[2]
const buf = z.zstdDecompressSync(fs.readFileSync(p))
const lines = buf.toString('utf8').split(/\r?\n/).filter(Boolean)
console.log('lines', lines.length)
for (const line of lines.slice(0, 6)) console.log(line.slice(0, 400))
