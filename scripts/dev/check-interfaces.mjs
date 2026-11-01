/** 接口检查：跨包只能 import 对方 src/index.{js,ts}，不许直接进内部文件。 */
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
for (const d of ['packages', 'scripts']) walk(path.join(root, d), files)

const problems = []
for (const f of files) {
  const rel = path.relative(root, f).replace(/\\/g, '/')
  const owner = pkgs.find((p) => rel.startsWith('packages/' + p + '/'))
  const text = fs.readFileSync(f, 'utf8')
  const re = /from\s+['"]([^'"]+)['"]/g
  let m
  while ((m = re.exec(text))) {
    const spec = m[1]
    if (!spec.startsWith('.')) continue
    const abs = path.resolve(path.dirname(f), spec).replace(/\\/g, '/')
    const hit = abs.match(/\/packages\/([^/]+)\/src\/(.+)$/)
    if (!hit) continue
    const target = hit[1]
    if (target === owner) continue
    const rest = hit[2]
    if (!/^index\.(js|ts)$/.test(rest)) {
      problems.push(`${rel} → packages/${target}/src/${rest}（应改用 packages/${target}/src/index）`)
    }
  }
}
if (!problems.length) { console.log('接口检查通过'); process.exit(0) }
console.log('跨包直接引用内部文件：')
for (const p of problems) console.log('  ' + p)
process.exit(1)
