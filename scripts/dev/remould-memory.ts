/**
 * 重建某只鱼的记忆：把水位线退回 0，然后跑一轮整理（真调模型）。
 *   node scripts/dev/remould-memory.ts <creatureId> [--dry]
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Memory } from '../../packages/memory/src/memory.ts'

const id = process.argv[2]
if (!id) { console.error('用法: remould-memory.ts <creatureId>'); process.exit(1) }
const dry = process.argv.includes('--dry')
const dir = path.join(os.homedir(), '.fishbowl', 'creatures', id)

const patch = fs.readFileSync(path.join(os.homedir(), '.dsh', 'profiles', 'desktop', 'cordis.patch.yml'), 'utf8')
const key = (patch.match(/apiKey:\s*(\S+)/) || [])[1]
if (!key) { console.error('没读到 apiKey'); process.exit(1) }

const llm = async (req) => {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model: req.model || 'deepseek-chat',
      messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
      temperature: 0.2,
      max_tokens: req.maxTokens || 900,
      ...(req.json ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const body = await res.json()
  return body.choices?.[0]?.message?.content ?? ''
}

const mem = new Memory({ dir, lock: 'off' })
const before = mem.view()
console.log('之前: turns=' + before.turns.length + ' watermark=' + before.watermark + ' memories=' + before.memories.length)
if (!dry) {
  mem.rewindTo(0)
  const report = await mem.tick({ llm, by: { model: 'deepseek-chat' }, force: true })
  console.log('tick:', JSON.stringify(report))
}
const after = mem.view()
console.log('之后: turns=' + after.turns.length + ' watermark=' + after.watermark + ' memories=' + after.memories.length)
for (const m of after.memories.slice(0, 10)) console.log('  [' + m.kind + '] ' + m.claim)
mem.close?.()
