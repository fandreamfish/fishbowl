import fs from 'node:fs'
import path from 'node:path'
const root = process.cwd()
const files = []
function walk(d) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n)
    const st = fs.statSync(p)
    if (st.isDirectory()) { if (!/node_modules|\.git|test/.test(p)) walk(p) }
    else if (/\.(ts|js)$/.test(n)) files.push(p)
  }
}
for (const d of ['packages', 'src', 'scripts']) walk(path.join(root, d))
const defs = []
for (const f of files) {
  const rel = path.relative(root, f).replace(/\\/g, '/')
  const text = fs.readFileSync(f, 'utf8')
  const re = /export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_][A-Za-z0-9_]*)/g
  let m
  while ((m = re.exec(text))) defs.push({ file: rel, name: m[1] })
}
const all = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n')
const dead = []
for (const d of defs) {
  if (d.name === 'default') continue
  const count = (all.match(new RegExp('\\b' + d.name + '\\b', 'g')) || []).length
  if (count <= 1) dead.push(d)
}
console.log('疑似未使用的导出：')
for (const d of dead) console.log('  ' + d.file + ' :: ' + d.name)
