/** 分层检查：依赖方向必须从外往内（adapter/app → 能力 → 核心）。 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const LAYER = {
  'packages/affect': 0,
  'packages/memory': 1,
  'packages/being': 1,
  'packages/schedule': 1,
  'packages/voice': 1,
  'packages/journal': 1,
  'packages/bilibili': 1,
  'packages/app': 2,
  'packages/adapter-dsh': 3,
  'packages/plugin': 3,
  'packages/bridge-qq': 3,
}

function layerOf(rel) {
  for (const k of Object.keys(LAYER).sort((a, b) => b.length - a.length)) {
    if (rel.startsWith(k + '/')) return { name: k, level: LAYER[k] }
  }
  if (rel.startsWith('src/core/')) return { name: 'src/core', level: 2 }
  if (rel.startsWith('scripts/')) return { name: 'scripts', level: 4 }
  return { name: 'other', level: 9 }
}

function walk(d, out) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n)
    const st = fs.statSync(p)
    if (st.isDirectory()) {
      if (/node_modules|\.git|test/.test(p)) continue
      walk(p, out)
    } else if (/\.(ts|js)$/.test(n)) out.push(p)
  }
}

const files = []
for (const d of ['packages']) walk(d, files)
const problems = []
for (const f of files) {
  const rel = path.relative(root, f).replace(/\\/g, '/')
  const from = layerOf(rel)
  if (from.level === 9) continue
  const text = fs.readFileSync(f, 'utf8')
  const re = /from\s+['"]([^'"]+)['"]/g
  let m
  while ((m = re.exec(text))) {
    const spec = m[1]
    if (!spec.startsWith('.')) continue
    const abs = path.resolve(path.dirname(f), spec)
    const r = path.relative(root, abs).replace(/\\/g, '/')
    const to = layerOf(r)
    if (to.level === 9) continue
    // 规则 1：只能依赖严格更内层，或者同层同包
    if (to.level > from.level) problems.push(`${rel} → ${r}  (${from.name} → ${to.name})`)
    // 规则 2：除了入口 plugin，谁都不许依赖入口或兼容层
    if ((to.name === 'packages/plugin' || to.name === 'src/core') && from.name !== 'packages/plugin') {
      problems.push(`${rel} → ${r}  (非入口依赖了 ${to.name})`)
    }
  }
}

if (problems.length === 0) {
  console.log('分层检查通过')
  process.exit(0)
}
console.log('分层违规：')
for (const p of problems) console.log('  ' + p)
process.exit(1)
