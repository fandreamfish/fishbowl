const fs = require('node:fs')
const zlib = require('node:zlib')
const p = process.argv[2]
const buf = fs.readFileSync(p)
console.log('head bytes:', buf.subarray(0, 16).toString('hex'))
let text
try { text = zlib.zstdDecompressSync(buf).toString('utf8') } catch (e) { console.log('decompress err', e.message); process.exit(1) }
console.log('decompressed length', text.length)
console.log('first 300:', JSON.stringify(text.slice(0, 300)))
const lines = text.split('\n').filter(Boolean)
console.log('lines', lines.length)
