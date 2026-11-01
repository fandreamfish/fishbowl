import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const exts = ['.ts', '.js']

function resolveSpec(fromAbs, spec) {
  if (!spec.startsWith('.')) return null
  const base = path.resolve(path.dirname(fromAbs), spec)
  for (const e of ['', ...exts]) {
    if (fs.existsSync(base + e) && fs.statSync(base + e).isFile()) return base + e
  }
  return null
}

function relocate(fromRel, toRel) {
  const fromAbs = path.join(root, fromRel)
  const toAbs = path.join(root, toRel)
  fs.mkdirSync(path.dirname(toAbs), { recursive: true })
  let text = fs.readFileSync(fromAbs, 'utf8')
  const re = /(from\s+['"])([^'"]+)(['"])/g
  text = text.replace(re, (all, a, spec, c) => {
    const target = resolveSpec(fromAbs, spec)
    if (!target) return all
    let rel = path.relative(path.dirname(toAbs), target).replace(/\\/g, '/')
    if (!rel.startsWith('.')) rel = './' + rel
    return a + rel + c
  })
  fs.rmSync(fromAbs)
  fs.writeFileSync(toAbs, text)
  // 旧路径留 shim
  const needsExt = toRel
  const relToNew = path.relative(path.dirname(fromAbs), toAbs).replace(/\\/g, '/')
  const spec = relToNew.startsWith('.') ? relToNew : './' + relToNew
  fs.writeFileSync(fromAbs, `// 兼容层：实现已迁到 ${toRel}\nexport * from '${spec}'\n`)
  return toRel
}

const moves = process.argv.slice(2)
for (let i = 0; i < moves.length; i += 2) {
  console.log(relocate(moves[i], moves[i + 1]))
}
