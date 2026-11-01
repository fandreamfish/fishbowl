/**
 * fishbowl CLI（M4）：看状态、改封存。
 *   node scripts/fishbowl-cli.ts list [--state-dir D]
 *   node scripts/fishbowl-cli.ts status <sessionId|creatureId> [--state-dir D]
 *   node scripts/fishbowl-cli.ts freeze <sessionId|creatureId> [--state-dir D]
 *   node scripts/fishbowl-cli.ts unfreeze <sessionId|creatureId> [--state-dir D]
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Creature } from '../src/core/creature.ts'
import { Memory } from '../packages/memory/src/memory.ts'
import { toBias } from '../src/core/engine.ts'

function arg(name, dflt) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : dflt
}

const stateDir = arg('--state-dir', path.join(os.homedir(), '.fishbowl', 'creatures'))
const [cmd, target] = process.argv.slice(2).filter(a => !a.startsWith('--'))

function allCreatures() {
  const out = []
  let names = []
  try { names = fs.readdirSync(stateDir).filter((n) => fs.existsSync(path.join(stateDir, n, 'meta.json'))) } catch { return out }
  for (const n of names) {
    try { out.push(Creature.open(path.join(stateDir, n))) } catch { /* 坏目录跳过 */ }
  }
  return out
}

function resolveCreature(target) {
  const all = allCreatures()
  // 先按个体 id，再按住处（会话/工作区），最后按名字
  const byId = all.find((c) => c.meta.creatureId === target)
  if (byId) return byId
  const byOcc = all.find((c) => c.meta.occupancy && (c.meta.occupancy.id === target || c.meta.occupancy.workspace === target))
  if (byOcc) return byOcc
  return all.find((c) => c.meta.name === target) ?? null
}

function fmtBias(c) {
  const affect = c.affectNow ? c.affectNow() : c.fold().affect
  const bias = toBias(affect, c.temperament)
  return `v=${affect.valence.toFixed(2)} a=${affect.arousal.toFixed(2)}`
    + ` guilt=${affect.guilt.toFixed(2)} longing=${affect.longing.toFixed(2)} frozen=${c.isFrozen()}`
    + `\n  bias: 话量${bias.verbosity.toFixed(2)} 拒绝${bias.thresholdRefuse.toFixed(2)} 验证${bias.thresholdVerify.toFixed(2)}`
    + ` 风险${bias.riskAppetite.toFixed(2)} 披露${bias.disclosure.toFixed(2)} 耐心${bias.patience.toFixed(2)}`
}

if (cmd === 'list') {
  console.log(`状态目录: ${stateDir}\n`)
  const all = allCreatures()
  if (all.length === 0) { console.log('（空）'); process.exit(0) }
  for (const c of all) {
    const turns = c.store.readEvents().filter((e) => e.t === 'episode' || e.t === 'turn').length
    const occ = c.meta.occupancy ? `${c.meta.occupancy.kind}:${c.meta.occupancy.id}` : '（没住处）'
    console.log(`个体 ${c.meta.creatureId.slice(0, 8)}  名字: ${c.meta.name}  出生: ${String(c.meta.bornAt).slice(0, 10)}  轮次: ${turns}`)
    console.log(`  住处 ${occ}`)
    console.log(`  ${fmtBias(c)}`)
  }
} else if (cmd === 'status' && target) {
  const c = resolveCreature(target)
  if (!c) { console.error(`找不到：${target}`); process.exit(1) }
  const m = new Memory({ dir: path.join(stateDir, c.meta.creatureId), lock: 'off' })
  const v = m.view()
  const active = v.memories.filter((x) => x.status === 'active')
  const ofKind = (k) => active.filter((x) => x.kind === k).slice(0, 3).map((x) => x.claim)
  const name = c.meta.name && !c.meta.name.startsWith('fish-') ? c.meta.name : null
  console.log(`名字: ${name ?? '（未命名）'}  个体: ${c.meta.creatureId.slice(0, 8)}  时区: ${c.meta.timezone}`)
  console.log(fmtBias(c))
  console.log('记得的事:', ofKind('fact').join('；') || '（无）')
  console.log('教训:', ofKind('lesson').join('；') || '（无）')
  console.log('自我认知:', ofKind('self').join('；') || '（还没有足够的经历）')
  console.log('未完成的承诺:', c.openCommitments().slice(-2).map((x) => x.text).join('；') || '（无）')
  console.log('正在一起做的事:', c.currentActivity() || '（无）')
  m.close?.()
  const pending = c.store.readOutbox().filter(o => !o.delivered)
  console.log('待投递:', pending.length === 0 ? '（无）' : `${pending.length} 条`)
} else if ((cmd === 'freeze' || cmd === 'unfreeze') && target) {
  const c = resolveCreature(target)
  if (!c) { console.error(`找不到：${target}`); process.exit(1) }
  if (cmd === 'freeze') {
    if (c.isFrozen()) { console.log('已经封存。'); process.exit(0) }
    c.recordFreeze()
    console.log(`已封存 ${c.meta.name}。它的时间停了——不经历、不缺席、不想念。`)
  } else {
    if (!c.isFrozen()) { console.log('并未封存。'); process.exit(0) }
    c.recordUnfreeze()
    console.log(`已解封 ${c.meta.name}。`)
  }
} else {
  console.log('用法:\n  fishbowl-cli.ts list [--state-dir D]\n  fishbowl-cli.ts status <sessionId|个体id|名字>\n  fishbowl-cli.ts freeze|unfreeze <sessionId|个体id|名字>')
  process.exit(1)
}
