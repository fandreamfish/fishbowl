/**
 * 复现一次合并：拿某只鱼的账本重建批次，跑一次合并模型，打印原始输出与闸门结果。
 *   node scripts/dev/repro-merge.ts <creatureId>
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Memory } from '../../packages/memory/src/index.ts'
import { buildMergeUser, gateMemories, MERGE_SYSTEM, parseMerge } from '../../packages/memory/src/index.ts'

const id = process.argv[2]
if (!id) { console.error('用法: repro-merge.ts <creatureId>'); process.exit(1) }
const dir = path.join(os.homedir(), '.fishbowl', 'creatures', id)
const mem = new Memory({ dir, lock: 'off' })
const view = mem.view()
const pending = view.turns.length - view.watermark
console.log('turns:', view.turns.length, 'watermark:', view.watermark, 'pending:', pending, 'memories:', view.memories.length)

// 用与 tick 相同的方式取批次
const cap = 20
const batch = view.turns.slice(view.watermark, view.watermark + cap)
const existing = view.memories.filter((m) => m.status === 'active').slice(-40).map((m) => ({ id: m.id, claim: m.claim, kind: m.kind }))
const system = MERGE_SYSTEM.replace('{{MIN}}', '2').replace('{{MAX}}', '12')
const user = buildMergeUser(batch, existing, ['工作', '生活', '情绪', '偏好'])

// 密钥从 profile patch 里读（本机调试用，不落盘）
const patch = fs.readFileSync(path.join(os.homedir(), '.dsh', 'profiles', 'desktop', 'cordis.patch.yml'), 'utf8')
const key = (patch.match(/apiKey:\s*(\S+)/) || [])[1]
if (!key) { console.error('没读到 apiKey'); process.exit(1) }

const res = await fetch('https://api.deepseek.com/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
  body: JSON.stringify({
    model: 'deepseek-chat',
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0.2,
    max_tokens: 900,
  }),
})
const body = await res.json()
const raw = body.choices?.[0]?.message?.content ?? ''
console.log('--- 原始输出（前 800 字）---')
console.log(raw.slice(0, 800))
const parsed = parseMerge(raw)
console.log('解析出候选:', parsed.length)
const gate = gateMemories(parsed, batch, ['工作', '生活', '情绪', '偏好'])
console.log('通过:', gate.accepted.length, ' 被拒:', JSON.stringify(gate.rejected.slice(0, 5), null, 1))
console.log('批次 id 样例:', batch.slice(0, 2).map((t) => t.id))
mem.close?.()
