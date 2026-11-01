import fs from 'node:fs'
import path from 'node:path'
const files = []
function walk(d) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n)
    const st = fs.statSync(p)
    if (st.isDirectory()) { if (!/node_modules|test|\.git|\.inspect/.test(p)) walk(p) }
    else if (/\.(ts|js)$/.test(n)) files.push(p)
  }
}
for (const d of ['src', 'packages/plugin', 'packages/memory', 'packages/bridge-qq']) walk(d)
const out = []
for (const f of files) {
  const dir = path.dirname(f)
  const text = fs.readFileSync(f, 'utf8')
  const re = /from\s+['"]([^'"]+)['"]/g
  let m
  const deps = new Set()
  while ((m = re.exec(text))) {
    const spec = m[1]
    if (!spec.startsWith('.')) continue
    let target = path.resolve(dir, spec).replace(/\\/g, '/')
    const base = target.replace(/\.(ts|js)$/, '')
    const hit = [base + '.ts', base + '.js'].find((c) => fs.existsSync(c))
    if (hit) deps.add(path.relative(process.cwd(), hit).replace(/\\/g, '/'))
    else deps.add('MISSING:' + spec)
  }
  out.push({ f: path.relative(process.cwd(), f).replace(/\\/g, '/'), deps: [...deps] })
}
for (const o of out.sort((a, b) => b.deps.length - a.deps.length).slice(0, 12)) {
  console.log(o.f + '  (' + o.deps.length + ')')
  console.log('   ' + o.deps.join(', '))
}
