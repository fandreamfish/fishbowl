import fs from 'node:fs'
const p = 'packages/plugin/client.js'
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/)
const start = lines.findIndex((l) => l.includes("page === 'home'"))
let end = -1
for (let i = start + 1; i < lines.length; i++) {
  if (lines[i].includes("] }, 'home-root')")) { end = i; break }
}
if (start < 0 || end < 0) { console.log('locate failed', start, end); process.exit(1) }
let body = lines.slice(start + 1, end + 1).join('\n').replace(/\s+$/, '')
body = body.replace(/^(\s*)body = e\(/m, '$1return e(')
const fn = ['      function renderHome() {', body, '      }']
const replaced = [...lines.slice(0, start), "      } else if (page === 'home') {", '        body = renderHome()', ...lines.slice(end + 1)]
const at = replaced.findIndex((l) => l.trim() === 'let body = null')
replaced.splice(at, 0, ...fn, '')
fs.writeFileSync(p, replaced.join('\n'))
console.log('home extracted')
