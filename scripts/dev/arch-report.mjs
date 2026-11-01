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
for (const d of ['src', 'packages']) walk(d, [])
const grp = (rel) => {
  if (rel.startsWith('src/')) return 'src(tools)'
  const m = rel.match(/^packages\/([^/]+)\//)
  return m ? m[1] : 'other'
}
const edges = new Map()
const shimUse = []
for (const f of files) {
  const rel = path.relative(root, f).replace(/\\/g, '/')
  const from = grp(rel)
  const text = fs.readFileSync(f, 'utf8')
  const re = /from\s+['"]([^'"]+)['"]/g
  let m
  while ((m = re.exec(text))) {
    const spec = m[1]
    if (!spec.startsWith('.')) continue
    const abs = path.resolve(path.dirname(f), spec)
    const r = path.relative(root, abs).replace(/\\/g, '/')
    const to = grp(r)
    if (to === from) continue
    const k = from + ' -> ' + to
    edges.set(k, (edges.get(k) || 0) + 1)
    if (r.startsWith('src/core/') || r.startsWith('packages/plugin/lib/') || r.startsWith('packages/plugin/memory/')) {
      if (!rel.startsWith('packages/plugin/') && !rel.startsWith('src/')) shimUse.push(rel + ' -> ' + r)
    }
  }
}
console.log('== 跨包依赖（次数） ==')
for (const [k, v] of [...edges].sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(3), k)
console.log('\n== 非 plugin/src 的代码仍通过 shim 导入 ==')
for (const s of shimUse) console.log('  ' + s)
