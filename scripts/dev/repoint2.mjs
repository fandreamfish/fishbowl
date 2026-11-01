import fs from 'node:fs'
import path from 'node:path'
const root = process.cwd()
const M = [
  ['src/core/types.ts', 'packages/affect/src/types.ts'],
  ['src/core/engine.ts', 'packages/affect/src/engine.ts'],
  ['src/core/growth.ts', 'packages/affect/src/growth.ts'],
  ['src/core/util.ts', 'packages/affect/src/util.ts'],
  ['src/core/creature.ts', 'packages/being/src/creature.ts'],
  ['src/core/store.ts', 'packages/being/src/store.ts'],
  ['src/core/tenancy.ts', 'packages/being/src/tenancy.ts'],
  ['src/core/signals.ts', 'packages/being/src/signals.ts'],
  ['src/core/commitment.ts', 'packages/being/src/commitment.ts'],
  ['src/core/activity.ts', 'packages/being/src/activity.ts'],
  ['src/core/scheduler.ts', 'packages/schedule/src/scheduler.ts'],
  ['src/core/contact.ts', 'packages/schedule/src/contact.ts'],
  ['src/core/browse.ts', 'packages/bilibili/src/browse.ts'],
  ['packages/plugin/lib/config.js', 'packages/app/src/config.js'],
  ['packages/plugin/lib/cfgkeys.js', 'packages/app/src/cfgkeys.js'],
  ['packages/plugin/lib/fishcfg.js', 'packages/app/src/fishcfg.js'],
  ['packages/plugin/lib/appraiser.js', 'packages/app/src/appraiser.js'],
  ['packages/plugin/lib/llm.js', 'packages/app/src/llm.js'],
  ['packages/plugin/lib/injector.js', 'packages/app/src/injector.js'],
  ['packages/plugin/lib/extract.js', 'packages/app/src/extract.js'],
  ['packages/plugin/lib/identity.js', 'packages/app/src/identity.js'],
  ['packages/plugin/lib/rename.js', 'packages/app/src/rename.js'],
  ['packages/plugin/lib/binding.js', 'packages/app/src/binding.js'],
  ['packages/plugin/lib/grant.js', 'packages/being/src/grant.js'],
  ['packages/plugin/lib/collector.js', 'packages/app/src/turn.js'],
  ['packages/plugin/lib/life.js', 'packages/app/src/wake.js'],
  ['packages/plugin/lib/ui-route.js', 'packages/adapter-dsh/src/http.js'],
  ['packages/plugin/host/dsh.js', 'packages/adapter-dsh/src/host.js'],
  ['packages/plugin/memory/store.js', 'packages/app/src/memory-store.js'],
  ['packages/plugin/lib/journal.js', 'packages/journal/src/journal.js'],
  ['packages/plugin/lib/voice.js', 'packages/voice/src/voice.js'],
  ['packages/plugin/lib/browse/client.js', 'packages/bilibili/src/client.js'],
  ['packages/plugin/lib/browse/comment.js', 'packages/bilibili/src/comment.js'],
  ['packages/plugin/lib/browse/risk.js', 'packages/bilibili/src/risk.js'],
  ['packages/plugin/lib/browse/store.js', 'packages/bilibili/src/store.js'],
  ['packages/plugin/lib/browse/guard.js', 'packages/bilibili/src/guard.js'],
  ['packages/plugin/lib/browse/runtime.js', 'packages/bilibili/src/runtime.js'],
  ['packages/plugin/lib/browse/auth.js', 'packages/bilibili/src/auth.js'],
]
function walk(d, out) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n)
    const st = fs.statSync(p)
    if (st.isDirectory()) { if (!/node_modules|\.git/.test(p)) walk(p, out) }
    else if (/\.(ts|js)$/.test(n)) out.push(p)
  }
}
const files = []
for (const d of ['src', 'packages', 'scripts']) walk(d, files)
let changed = 0
for (const f of files) {
  const rel = path.relative(root, f).replace(/\\/g, '/')
  // 跳过 shim 自身
  if (rel.startsWith('src/core/') || (rel.startsWith('packages/plugin/lib/') && !/constraints|types\.js|browse\/tool|browse\/speak-tool/.test(rel)) || rel === 'packages/plugin/host/dsh.js' || rel === 'packages/plugin/memory/store.js') continue
  let text = fs.readFileSync(f, 'utf8')
  const before = text
  text = text.replace(/(from\s+['"])([^'"]+)(['"])/g, (all, a, spec, c) => {
    if (!spec.startsWith('.')) return all
    const abs = path.resolve(path.dirname(f), spec).replace(/\\/g, '/')
    const hit = M.find(([old]) => abs.endsWith('/' + old) || abs.endsWith(old))
    if (!hit) return all
    let next = path.relative(path.dirname(f), path.join(root, hit[1])).replace(/\\/g, '/')
    if (!next.startsWith('.')) next = './' + next
    return a + next + c
  })
  if (text !== before) { fs.writeFileSync(f, text); changed++ }
}
console.log('rewritten files:', changed)
