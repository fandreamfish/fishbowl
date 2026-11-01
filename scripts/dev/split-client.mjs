import fs from 'node:fs'
const p = 'packages/plugin/client.js'
let src = fs.readFileSync(p, 'utf8')
const pages = ['status', 'routine', 'browse', 'persona', 'memory']
const fns = []
for (const page of pages) {
  const marker = `if (page === '${page}') {`
  const start = src.indexOf(marker)
  if (start < 0) { console.log('missing', page); continue }
  const bodyStart = src.indexOf('\n', start) + 1
  // 找下一个 else-if 或收尾（home 的结尾不同）
  const nextMarkers = ['} else if (page === ', '      } else if (page === ']
  let end = -1
  for (const nm of nextMarkers) {
    const idx = src.indexOf(nm, bodyStart)
    if (idx >= 0 && (end < 0 || idx < end)) end = idx
  }
  if (end < 0) { console.log('no end', page); continue }
  let body = src.slice(bodyStart, end)
  // 去掉结尾空白
  body = body.replace(/\s+$/, '')
  // body = e(...) → return e(...)
  body = body.replace(/^(\s*)body = /m, '$1return ')
  // home 分支结尾 `] }, 'home-root')      } else if` 已由 end 定位
  const fn = `      function render${page[0].toUpperCase() + page.slice(1)}() {\n${body}\n      }\n`
  fns.push(fn)
  // 用调用替换整段
  const replacement = `${marker}\n        body = render${page[0].toUpperCase() + page.slice(1)}()\n      `
  src = src.slice(0, start) + replacement + src.slice(end)
}
// 把函数插到 let body = null 前
const anchor = '      let body = null'
src = src.replace(anchor, fns.join('\n') + '\n' + anchor)
fs.writeFileSync(p, src)
console.log('done, functions:', fns.length)
