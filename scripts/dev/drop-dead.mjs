import fs from 'node:fs'
const jobs = [
  ['packages/bilibili/src/browse.js', 'gather'],
  ['packages/bilibili/src/browse.ts', 'isBvid'],
  ['packages/bilibili/src/guard.js', 'safeMaterialText'],
  ['packages/bilibili/src/store.js', 'lastSeenAt'],
]
for (const [file, name] of jobs) {
  const src = fs.readFileSync(file, 'utf8')
  const lines = src.split(/\r?\n/)
  const start = lines.findIndex((l) => new RegExp('export (async )?function ' + name + '\\b').test(l))
  if (start < 0) { console.log('missing', name); continue }
  // 向上吞掉紧邻的 JSDoc
  let docStart = start
  while (docStart > 0 && /^\s*\/\*\*/.test(lines[docStart - 1]) === false && /^\s*\*/.test(lines[docStart - 1])) docStart--
  if (docStart > 0 && /^\s*\/\*\*/.test(lines[docStart - 1])) docStart--
  let depth = 0
  let end = -1
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) { if (ch === '{') depth++; else if (ch === '}') depth-- }
    if (depth === 0 && i > start) { end = i; break }
  }
  if (end < 0) { console.log('no end', name); continue }
  // 连带后面一个空行
  let cutEnd = end
  if (lines[cutEnd + 1] === '') cutEnd++
  lines.splice(docStart, cutEnd - docStart + 1)
  fs.writeFileSync(file, lines.join('\n'))
  console.log('removed', name, 'from', file)
}
