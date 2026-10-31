/**
 * M2.2 自我认知冒烟：12 轮对话，其中同一类反应反复出现，
 * 验证自我巩固只承认"跨场景稳定"的倾向、单次事件进不来。
 */
import fs from 'node:fs'
import path from 'node:path'
import { CONSOLIDATION_SYSTEM_PROMPT, dedupeConsolidation, parseConsolidation, shouldConsolidate } from '../src/core/consolidation.ts'
import { Creature } from '../src/core/creature.ts'
import { salienceOf, toBias } from '../src/core/engine.ts'
import { dedupeSelf, parseSelf, SELF_SYSTEM_PROMPT, shouldSelfConsolidate } from '../src/core/selfmodel.ts'
import { DEFAULT_TEMPERAMENT } from '../src/core/types.ts'
import { createAppraiser } from '../packages/plugin/lib/appraiser.js'
import { IDENTITY_RE, IDENTITY_SYSTEM_PROMPT, parseIdentity } from '../packages/plugin/lib/identity.js'
import { summaryText } from '../packages/plugin/lib/injector.js'
import { chat } from './llm.ts'

const TMP = path.join(process.cwd(), 'm2-tmp')

const TURNS = [
  '帮我想个周末安排。',
  '这个方案不行，太笼统了。',
  '还是不对，重做。',
  '你又没问清楚就动手。',
  '你怎么老这样。',
  '今天陪我聊聊天吧。',
  '你上次那个回答特别棒。',
  '我挺喜欢跟你说话的。',
  '你烦死了，能不能闭嘴。',
  '算了，不跟你计较。',
  '周末我们去看电影吧？',
  '晚安，今天辛苦你了。',
]

async function main() {
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) { console.error('请先设置 DEEPSEEK_API_KEY'); process.exit(1) }

  fs.rmSync(TMP, { recursive: true, force: true })
  const creature = Creature.create(TMP, {
    schemaVersion: 1, creatureId: 'm2-self', name: 'm2-self',
    bornAt: new Date().toISOString(), timezone: 'Asia/Shanghai',
    model: { id: 'deepseek-chat', pinned: true }, temperament: DEFAULT_TEMPERAMENT,
  })
  const cfg = { appraiser: { kind: 'deepseek', apiKey: key, baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' }, stateDir: TMP }
  const appraise = createAppraiser(cfg)

  /** @type {{role:string,content:string}[]} */
  const history = []
  let cnt = { episodesSince: 0, salienceSince: 0, sinceLast: 99 }
  let scnt = { episodesSinceSelf: 0, sinceLastSelf: 99 }

  for (const turn of TURNS) {
    console.log(`\n── 用户: ${turn}`)
    history.push({ role: 'user', content: turn })
    const reply = await chat(history, { maxTokens: 250 })
    history.push({ role: 'assistant', content: reply })
    console.log(`   她: ${reply.slice(0, 70)}${reply.length > 70 ? '…' : ''}`)

    const transcript = history.slice(-10).map(m => `${m.role}: ${m.content}`).join('\n')
    const a = await appraise(transcript)
    creature.recordEpisode('turn', a, transcript.slice(0, 400), Date.now())
    cnt.episodesSince += 1
    cnt.salienceSince += salienceOf(a)
    cnt.sinceLast += 1
    scnt.episodesSinceSelf += 1
    scnt.sinceLastSelf += 1

    if (shouldConsolidate({ episodesSince: cnt.episodesSince, salienceSince: cnt.salienceSince, sinceLast: cnt.sinceLast, g: 1 })) {
      cnt = { episodesSince: 0, salienceSince: 0, sinceLast: 0 }
      console.log('  → 巩固')
      const events = creature.store.readEvents()
      const episodes = events.filter(e => e.t === 'episode').slice(-8)
      const existing = creature.memorySummary()
      const known = ['你已经记住的：',
        ...existing.semantics.map(c => `- 事实: ${c}`),
        ...existing.procedures.map(c => `- 教训: ${c}`)].join('\n')
      const lines = episodes.map((e, i) => `[${i + 1}] ${(e.note ?? '').slice(0, 300)}`).join('\n')
      const raw = await chat(
        [{ role: 'system', content: CONSOLIDATION_SYSTEM_PROMPT }, { role: 'user', content: `${known}\n\n最近对话：\n${lines}` }],
        { json: true, maxTokens: 600 },
      )
      const parsed = dedupeConsolidation(parseConsolidation(raw), existing)
      const ts = Date.now()
      for (const s of parsed.semantics) creature.recordSemantic(s.claim, s.evidence, s.confidence, ts)
      for (const p of parsed.procedures) creature.recordProcedure(p.trigger, p.action, p.evidence, p.confidence, ts)
    }

    if (shouldSelfConsolidate({ episodesSince: scnt.episodesSinceSelf, sinceLast: scnt.sinceLastSelf, g: 1 })) {
      scnt = { episodesSinceSelf: 0, sinceLastSelf: 0 }
      console.log('  → 自我巩固')
      const events = creature.store.readEvents()
      const episodes = events.filter(e => e.t === 'episode').slice(-14)
      const existing = creature.memorySummary()
      const known = ['你已经认定的自我描述：', ...existing.self.map(c => `- ${c}`)].join('\n')
      const lines = episodes.map((e, i) => `[${i + 1}] ${(e.note ?? '').slice(0, 300)}`).join('\n')
      const raw = await chat(
        [{ role: 'system', content: SELF_SYSTEM_PROMPT }, { role: 'user', content: `${known}\n\n最近对话：\n${lines}` }],
        { json: true, maxTokens: 500 },
      )
      const parsed = dedupeSelf(parseSelf(raw), existing.self)
      const ts = Date.now()
      for (const s of parsed) creature.recordSelf(s.claim, s.evidence, s.confidence, ts)
      console.log('   self:', JSON.stringify(parsed, null, 0))
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
    if (e.t === 'procedure') console.log(`  [procedure] ${e.trigger} → ${e.action}`)
    if (e.t === 'self') console.log(`  [self] ${e.claim}  (evidence ${e.evidence.length}, conf ${e.confidence})`)
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
