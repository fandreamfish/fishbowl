/**
 * 看某只鱼的记忆现状（调试用，走新的记忆模块）。
 *   node scripts/dev/probe-memory.ts <creatureId|个体目录>
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { Memory } from '../../packages/memory/src/memory.ts'

const arg = process.argv[2]
if (!arg) {
  const dir = path.join(os.homedir(), '.fishbowl', 'creatures')
  const ids = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, 'meta.json'))) : []
  console.error('用法: node scripts/dev/probe-memory.ts <creatureId|目录>')
  if (ids.length) console.error('现有: ' + ids.join(', '))
  process.exit(1)
}

const dir = fs.existsSync(arg) && fs.statSync(arg).isDirectory()
  ? arg
  : path.join(os.homedir(), '.fishbowl', 'creatures', arg)
if (!fs.existsSync(path.join(dir, 'meta.json'))) {
  console.error('找不到个体:', dir)
  process.exit(1)
}

const mem = new Memory({ dir, lock: 'off' })
const v = mem.view()
console.log('名字:', v.meta?.name ?? '(未命名)')
console.log('记忆条数:', v.memories.length, ' 原始轮次:', v.turns.length)
console.log('---- 记忆（按权重）----')
for (const m of v.memories.slice(0, 30)) {
  console.log(`  [${m.kind}/${m.subject ?? '-'}] ${m.claim}`)
}
const stats = mem.stats?.()
if (stats) console.log('统计:', JSON.stringify(stats))
mem.close?.()
