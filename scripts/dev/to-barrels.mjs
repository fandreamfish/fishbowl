import fs from 'node:fs'
import path from 'node:path'
const root = process.cwd()
const pkgs = fs.readdirSync(path.join(root, 'packages')).filter((n) => fs.existsSync(path.join(root, 'packages', n, 'src')))
function walk(d, out) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n)
    const st = fs.statSync(p)
    if (st.isDirectory()) { if (!/node_modules|\.git/.test(p)) walk(p, out) }
    else if (/\.(ts|js)$/.test(n)) out.push(p)
  }
}
const files = []
for (const d of ['src', 'packages', 'scripts']) walk(path.join(root, d), files)
let changed = 0
for (const f of files) {
  const rel = path.relative(root, f).replace(/\\/g, '/')
  const owner = pkgs.find((p) => rel.startsWith('packages/' + p + '/'))
  let text = fs.readFileSync(f, 'utf8')
  const before = text
  text = text.replace(/(from\s+['"])([^'"]+)(['"])/g, (all, a, spec, c) => {
    if (!spec.startsWith('.')) return all
    const abs = path.resolve(path.dirname(f), spec).replace(/\\/g, '/')
    const m = abs.match(/\/packages\/([^/]+)\/src\/(.+)$/)
    if (!m) return all
    const target = m[1]
    // 同包内部引用保持原样
    if (owner === target) return all
    // 已经是 index 就不动
    if (/\/index\.(ts|js)$/.test(abs)) return all
    const index = path.join(root, 'packages', target, 'src', 'index.js')
    if (!fs.existsSync(index) && !fs.existsSync(index.replace(/\.js$/, '.ts'))) return all
    const real = fs.existsSync(index) ? index : index.replace(/\.js$/, '.ts')
    let next = path.relative(path.dirname(f), real).replace(/\\/g, '/')
    if (!next.startsWith('.')) next = './' + next
    return a + next + c
  })
  if (text !== before) { fs.writeFileSync(f, text); changed++ }
}
console.log('rewritten:', changed)
