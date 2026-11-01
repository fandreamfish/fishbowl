import fs from 'node:fs'
const p = 'packages/plugin/client.js'
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/)
let start = lines.findIndex((l) => l.includes("page === 'memory'"))
let end = -1
for (let i = start + 1; i < lines.length; i++) {
  if (lines[i] === '      }') { end = i; break }
}
if (start < 0 || end < 0) { console.log('locate failed', start, end); process.exit(1) }
let body = lines.slice(start + 1, end).join('\n').replace(/\s+$/, '')
body = body.replace(/^(\s*)body = /m, '$1return ')
const fn = ['      function renderMemory() {', body, '      }']
// 替换分支
const next = [...lines.slice(0, start + 1), '        body = renderMemory()', ...lines.slice(end)]
// 插入函数到 let body = null 之前
const at = next.findIndex((l) => l.trim() === 'let body = null')
next.splice(at, 0, ...fn, '')
fs.writeFileSync(p, next.join('\n'))
console.log('memory extracted')
