/**
 * M2.1 巩固冒烟：真实 LLM 跑完整链路
 *   对话（生活向）→ 评价 → 情节落盘 → 触发巩固 → 语义/教训落盘 → 身份（起名）
 * 输出：事件日志摘要 + memorySummary + 注入示例。
 */
import fs from 'node:fs'
import path from 'node:path'
import { CONSOLIDATION_SYSTEM_PROMPT, dedupeConsolidation, parseConsolidation, shouldConsolidate } from '../../src/core/consolidation.ts'
import { Creature } from '../../packages/being/src/creature.ts'
import { salienceOf, toBias } from '../../packages/affect/src/engine.ts'
import { DEFAULT_TEMPERAMENT } from '../../packages/affect/src/types.ts'
import { createAppraiser } from '../../packages/app/src/appraiser.js'
import { IDENTITY_RE, IDENTITY_SYSTEM_PROMPT, parseIdentity } from '../../packages/app/src/identity.js'
import { summaryText } from '../../packages/app/src/injector.js'
import { chat } from './llm.ts'

const TMP = path.join(process.cwd(), 'm2-tmp')

const TURNS = [
  '我今天领养了一只猫，叫煤球。',
  '我不喜欢别人催我，一催我就烦。',
  '给你起个名字，你就叫大肥鱼吧。',
  '大肥鱼，你喜欢猫吗？',
  '我讨厌说话绕弯子的人，以后有话直说。',
]

async function main() {
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) { console.error('请先设置 DEEPSEEK_API_KEY'); process.exit(1) }

  fs.rmSync(TMP, { recursive: true, force: true })
  const creature = Creature.create(TMP, {
    schemaVersion: 1, creatureId: 'm2-smoke', name: 'm2-smoke',
    bornAt: new Date().toISOString(), timezone: 'Asia/Shanghai',
    model: { id: 'deepseek-chat', pinned: true }, temperament: DEFAULT_TEMPERAMENT,
  })
  const cfg = { appraiser: { kind: 'deepseek', apiKey: key, baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' }, stateDir: TMP }
  const appraise = createAppraiser(cfg)

  /** @type {{role:string,content:string}[]} */
  const history = []
  let cnt = { episodesSince: 0, salienceSince: 0, sinceLast: 99 }

  for (const turn of TURNS) {
    console.log(`\n── 用户: ${turn}`)
    history.push({ role: 'user', content: turn })
    const reply = await chat(history, { maxTokens: 300 })
    history.push({ role: 'assistant', content: reply })
    console.log(`   她: ${reply.slice(0, 80)}${reply.length > 80 ? '…' : ''}`)

    const transcript = history.slice(-8).map(m => `${m.role}: ${m.content}`).join('\n')
    const a = await appraise(transcript)
    creature.recordEpisode('turn', a, transcript.slice(0, 400), Date.now())
    cnt.episodesSince += 1
    cnt.salienceSince += salienceOf(a)
    cnt.sinceLast += 1

    if (shouldConsolidate({ episodesSince: cnt.episodesSince, salienceSince: cnt.salienceSince, sinceLast: cnt.sinceLast, g: 1 })) {
      cnt = { episodesSince: 0, salienceSince: 0, sinceLast: 0 }
      console.log('  → 触发巩固')
      const events = creature.store.readEvents()
      const episodes = events.filter(e => e.t === 'episode').slice(-8)
      const existing = creature.memorySummary()
      const known = [
        '你已经记住的：',
        ...existing.semantics.map((c) => `- 事实: ${c}`),
        ...existing.procedures.map((c) => `- 教训: ${c}`),
      ].join('\n')
      const lines = episodes.map((e, i) => `[${i + 1}] ${(e.note ?? '').slice(0, 300)}`).join('\n')
      const raw = await chat(
        [{ role: 'system', content: CONSOLIDATION_SYSTEM_PROMPT }, { role: 'user', content: `${known}\n\n最近对话：\n${lines}` }],
        { json: true, maxTokens: 600 },
      )
      const parsed = dedupeConsolidation(parseConsolidation(raw), existing)
      const ts = Date.now()
      for (const s of parsed.semantics) creature.recordSemantic(s.claim, s.evidence, s.confidence, ts)
      for (const p of parsed.procedures) creature.recordProcedure(p.trigger, p.action, p.evidence, p.confidence, ts)
      console.log('   semantics :', JSON.stringify(parsed.semantics, null, 0))
      console.log('   procedures:', JSON.stringify(parsed.procedures, null, 0))
    }

    if (IDENTITY_RE.test(transcript)) {
      const raw = await chat(
        [{ role: 'system', content: IDENTITY_SYSTEM_PROMPT }, { role: 'user', content: transcript.slice(-800) }],
        { json: true, maxTokens: 60 },
      )
      const name = parseIdentity(raw)
      if (name && name !== creature.meta.name) {
        creature.recordIdentity(name)
        console.log(`  → 起名: ${name}`)
      }
    }
  }

  console.log('\n════ 最终事件日志 ════')
  for (const e of creature.store.readEvents()) {
    if (e.t === 'semantic') console.log(`  [semantic] ${e.claim}  (conf ${e.confidence})`)
    if (e.t === 'procedure') console.log(`  [procedure] ${e.trigger} → ${e.action}  (conf ${e.confidence})`)
    if (e.t === 'identity') console.log(`  [identity] ${e.name}`)
  }

  const memory = creature.memorySummary()
  console.log('\n════ memorySummary ════')
  console.log(JSON.stringify(memory, null, 2))

  const affect = creature.fold().affect
  const bias = toBias(affect, creature.temperament)
  console.log('\n════ 下一轮注入示例 ════')
  console.log(summaryText(bias, affect, memory))
}

main().catch((err) => {
  console.error('冒烟失败：', err)
  process.exit(1)
})
