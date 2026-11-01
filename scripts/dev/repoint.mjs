/** 把经过兼容层的 import 直接指向真正的实现包。 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const MAP = {
  'types.ts': 'packages/affect/src/types.ts', 'engine.ts': 'packages/affect/src/engine.ts',
  'growth.ts': 'packages/affect/src/growth.ts', 'util.ts': 'packages/affect/src/util.ts',
  'store.ts': null, 'creature.ts': 'packages/being/src/creature.ts',
  'tenancy.ts': 'packages/being/src/tenancy.ts', 'signals.ts': 'packages/being/src/signals.ts',
  'commitment.ts': 'packages/being/src/commitment.ts', 'activity.ts': 'packages/being/src/activity.ts',
  'scheduler.ts': 'packages/schedule/src/scheduler.ts', 'contact.ts': 'packages/schedule/src/contact.ts',
  'voice.js': 'packages/voice/src/voice.js', 'journal.js': 'packages/journal/src/journal.js',
  'browse.ts': 'packages/bilibili/src/browse.ts',
  'client.js': 'packages/bilibili/src/client.js', 'comment.js': 'packages/bilibili/src/comment.js',
  'risk.js': 'packages/bilibili/src/risk.js', 'guard.js': 'packages/bilibili/src/guard.js',
  'runtime.js': 'packages/bilibili/src/runtime.js',
  'config.js': 'packages/app/src/config.js', 'cfgkeys.js': 'packages/app/src/cfgkeys.js',
  'fishcfg.js': 'packages/app/src/fishcfg.js', 'appraiser.js': 'packages/app/src/appraiser.js',
  'llm.js': 'packages/app/src/llm.js', 'injector.js': 'packages/app/src/injector.js',
  'extract.js': 'packages/app/src/extract.js', 'grant.js': 'packages/app/src/grant.js',
  'identity.js': 'packages/app/src/identity.js', 'rename.js': 'packages/app/src/rename.js',
  'binding.js': 'packages/app/src/binding.js',
}
// 同名不同包：browse 目录下的 store.js 归 bilibili
const BROWSE_STORE = 'packages/bilibili/src/store.js'

function walk(d, out) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n)
    const st = fs.statSync(p)
    if (st.isDirectory()) { if (!/node_modules|\.git/.test(p)) walk(p, out) }
    else if (/\.(ts|js)$/.test(n)) out.push(p)
  }
}
const files = []
for (const d of ['packages', 'src']) walk(d, files)

let changed = 0
for (const f of files) {
  let text = fs.readFileSync(f, 'utf8')
  const before = text
  text = text.replace(/(from\s+['"])([^'"]+)(['"])/g, (all, a, spec, c) => {
    if (!spec.startsWith('.')) return all
    const abs = path.resolve(path.dirname(f), spec)
    const rel = path.relative(root, abs).replace(/\\/g, '/')
    // 只处理兼容层里的路径
    if (!/^packages\/plugin\/lib\//.test(rel) && !/^src\/core\//.test(rel)) return all
    const base = path.basename(rel)
    let target = MAP[base]
    if (base === 'store.js' && rel.includes('/browse/')) target = BROWSE_STORE
    if (base === 'store.js' && rel.startsWith('src/core/')) target = 'packages/being/src/store.ts'
    if (base === 'memory-store.js') target = 'packages/app/src/memory-store.js'
    if (!target || !fs.existsSync(path.join(root, target))) return all
    let next = path.relative(path.dirname(f), path.join(root, target)).replace(/\\/g, '/')
    if (!next.startsWith('.')) next = './' + next
    return a + next + c
  })
  if (text !== before) { fs.writeFileSync(f, text); changed++ }
}
console.log('repointed files:', changed)
