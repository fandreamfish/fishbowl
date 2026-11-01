import fs from 'node:fs'
import path from 'node:path'

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(js|ts)$/.test(e.name)) out.push(p)
  }
  return out
}

const pkgs = fs.readdirSync('packages').filter((d) => fs.statSync(path.join('packages', d)).isDirectory())
const rows = []
for (const pkg of pkgs) {
  const files = walk(path.join('packages', pkg)).filter((f) => !f.includes(path.join('test')) && !f.endsWith('.d.ts'))
  const lines = files.reduce((n, f) => n + fs.readFileSync(f, 'utf8').split('\n').length, 0)
  rows.push({ pkg, files: files.length, lines })
}
rows.sort((a, b) => b.lines - a.lines)
console.log(rows.map((r) => `${r.pkg.padEnd(16)} files=${String(r.files).padStart(3)} lines=${r.lines}`).join('\n'))

const all = walk('packages')
const big = all.map((f) => ({ f, n: fs.readFileSync(f, 'utf8').split('\n').length })).sort((a, b) => b.n - a.n).slice(0, 15)
console.log('\n-- largest --')
for (const b of big) console.log(String(b.n).padStart(4), b.f)
