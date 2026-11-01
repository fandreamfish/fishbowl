import fs from 'node:fs'
import path from 'node:path'
const files = []
function walk(d) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n)
    const st = fs.statSync(p)
    if (st.isDirectory()) { if (!/node_modules|test|\.git/.test(p)) walk(p) }
    else if (/\.(ts|js)$/.test(n)) files.push(p)
  }
}
for (const d of ['src', 'packages']) walk(d)
const edges = new Map()
const group = (f) => {
  const rel = f.replace(/\\/g, '/')
  if (rel.startsWith('src/core/')) return 'core'
  if (rel.startsWith('packages/memory/')) return 'memory'
  if (rel.startsWith('packages/plugin/host/')) return 'host'
  if (rel.startsWith('packages/plugin/lib/')) return 'plugin/lib'
  if (rel.startsWith('packages/plugin/')) return 'plugin'
  if (rel.startsWith('packages/bridge-qq/')) return 'bridge'
  return 'other'
}
for (const f of files) {
  const dir = path.dirname(f)
  const text = fs.readFileSync(f, 'utf8')
  const re = /from\s+['"]([^'"]+)['"]/g
  let m
  while ((m = re.exec(text))) {
    const spec = m[1]
    if (!spec.startsWith('.')) continue
    let target = path.resolve(dir, spec).replace(/\\/g, '/')
    target = target.replace(/\.(ts|js)$/, '')
    // 找真实文件
    const cands = [target + '.ts', target + '.js', target.replace(/\.ts$/, '') + '.js']
    const hit = cands.find((c) => fs.existsSync(c))
    const g = hit ? group(path.relative(process.cwd(), hit).replace(/\\/g, '/')) : 'missing'
    const key = group(path.relative(process.cwd(), f).replace(/\\/g, '/')) + ' -> ' + g
    edges.set(key, (edges.get(key) || 0) + 1)
  }
}
for (const [k, v] of [...edges].sort()) console.log(String(v).padStart(3), k)
