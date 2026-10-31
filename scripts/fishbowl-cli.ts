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
import { toBias } from '../src/core/engine.ts'

function arg(name, dflt) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : dflt
}

const stateDir = arg('--state-dir', path.join(os.homedir(), '.fishbowl', 'creatures'))
const [cmd, target] = process.argv.slice(2).filter(a => !a.startsWith('--'))

function loadBindings() {
  try {
    return JSON.parse(fs.readFileSync(path.join(stateDir, 'bindings.json'), 'utf8'))
  } catch {
    return {}
  }
}

function resolveCreature(target) {
  const bindings = loadBindings()
  // 先按会话 id，再按个体 id，最后按名字
  if (bindings[target]) return Creature.open(path.join(stateDir, bindings[target]))
  if (fs.existsSync(path.join(stateDir, target, 'meta.json'))) return Creature.open(path.join(stateDir, target))
  for (const [sid, cid] of Object.entries(bindings)) {
    const c = Creature.open(path.join(stateDir, String(cid)))
    if (c.meta.name === target) return c
  }
  return null
}

function fmtBias(c) {
  const affect = c.fold().affect
  const bias = toBias(affect, c.temperament)
  return `v=${affect.valence.toFixed(2)} a=${affect.arousal.toFixed(2)}`
    + ` guilt=${affect.guilt.toFixed(2)} longing=${affect.longing.toFixed(2)} frozen=${c.isFrozen()}`
    + `\n  bias: 话量${bias.verbosity.toFixed(2)} 拒绝${bias.thresholdRefuse.toFixed(2)} 验证${bias.thresholdVerify.toFixed(2)}`
    + ` 风险${bias.riskAppetite.toFixed(2)} 披露${bias.disclosure.toFixed(2)} 耐心${bias.patience.toFixed(2)}`
}

if (cmd === 'list') {
  const bindings = loadBindings()
  console.log(`状态目录: ${stateDir}\n`)
  if (Object.keys(bindings).length === 0) { console.log('（空）'); process.exit(0) }
  for (const [sid, cid] of Object.entries(bindings)) {
    try {
      const c = Creature.open(path.join(stateDir, String(cid)))
      const episodes = c.store.readEvents().filter(e => e.t === 'episode').length
      console.log(`会话 ${sid}`)
      console.log(`  个体 ${cid.slice(0, 8)}  名字: ${c.meta.name}  出生: ${c.meta.bornAt.slice(0, 10)}  轮次: ${episodes}`)
      console.log(`  ${fmtBias(c)}`)
    } catch (err) {
      console.log(`会话 ${sid} → ${cid.slice(0, 8)}: 读取失败 ${String(err?.message ?? err)}`)
    }
  }
} else if (cmd === 'status' && target) {
  const c = resolveCreature(target)
  if (!c) { console.error(`找不到：${target}`); process.exit(1) }
  const mem = c.memorySummary()
  console.log(`名字: ${mem.name ?? '（未命名）'}  个体: ${c.meta.creatureId.slice(0, 8)}  时区: ${c.meta.timezone}`)
  console.log(fmtBias(c))
  console.log('记得的事:', mem.semantics.join('；') || '（无）')
  console.log('教训:', mem.procedures.join('；') || '（无）')
  console.log('自我认知:', mem.self.join('；') || '（还没有足够的经历）')
  console.log('未完成的承诺:', mem.commitments.join('；') || '（无）')
  console.log('正在一起做的事:', mem.activity || '（无）')
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
