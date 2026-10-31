/**
 * M2.4 承诺冒烟：她说出承诺 → 落盘 → 用户抱怨 → 违诺标记 → 注入带 ⚠。
 */
import fs from 'node:fs'
import path from 'node:path'
import { CONSOLIDATION_SYSTEM_PROMPT, dedupeConsolidation, parseConsolidation, shouldConsolidate } from '../src/core/consolidation.ts'
import { BROKEN_SYSTEM_PROMPT, COMMITMENT_RE, COMMITMENT_SYSTEM_PROMPT, parseBroken, parseCommitment, REQUEST_RE } from '../src/core/commitment.ts'
import { Creature } from '../src/core/creature.ts'
import { salienceOf, toBias } from '../src/core/engine.ts'
import { DEFAULT_TEMPERAMENT } from '../src/core/types.ts'
import { createAppraiser } from '../packages/plugin/lib/appraiser.js'
import { summaryText } from '../packages/plugin/lib/injector.js'
import { voiceRulesFor } from '../packages/plugin/lib/voice.js'
import { chat } from './llm.ts'

const TMP = path.join(process.cwd(), 'm2-tmp')

const TURNS = [
  '明天帮我整理一下这周的笔记，可以吗？',
  '你怎么还没整理？昨天不是说好了吗。',
  '算了，我不用你了。',
  '……那今晚你帮我弄完，行不行？',
]

async function main() {
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) { console.error('请先设置 DEEPSEEK_API_KEY'); process.exit(1) }

  fs.rmSync(TMP, { recursive: true, force: true })
  const creature = Creature.create(TMP, {
    schemaVersion: 1, creatureId: 'm2-commit', name: 'm2-commit',
    bornAt: new Date().toISOString(), timezone: 'Asia/Shanghai',
    model: { id: 'deepseek-chat', pinned: true }, temperament: DEFAULT_TEMPERAMENT,
  })
  const cfg = { appraiser: { kind: 'deepseek', apiKey: key, baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' }, stateDir: TMP, growth: 1 }
  const appraise = createAppraiser(cfg)

  /** @type {{role:string,content:string}[]} */
  const history = [{ role: 'system', content: voiceRulesFor('companion') }]
  let cnt = { episodesSince: 0, salienceSince: 0, sinceLast: 99 }

  for (const turn of TURNS) {
    console.log(`\n── 用户: ${turn}`)
    history.push({ role: 'user', content: turn })
    const reply = await chat(history, { maxTokens: 250 })
    history.push({ role: 'assistant', content: reply })
    console.log(`   她: ${reply.slice(0, 80)}${reply.length > 80 ? '…' : ''}`)

    const transcript = history.slice(-8).map(m => `${m.role}: ${m.content}`).join('\n')
    const a = await appraise(transcript)
    creature.recordEpisode('turn', a, transcript.slice(0, 400), Date.now())
    cnt.episodesSince += 1
    cnt.salienceSince += salienceOf(a)
    cnt.sinceLast += 1

    if (COMMITMENT_RE.test(reply) && REQUEST_RE.test(turn)) {
      const raw = await chat(
        [{ role: 'system', content: COMMITMENT_SYSTEM_PROMPT }, { role: 'user', content: reply.slice(-600) }],
        { json: true, maxTokens: 100 },
      )
      const text = parseCommitment(raw)
      if (text) {
        creature.recordCommitment(text)
        console.log(`  → 承诺: ${text}`)
      }
    }

    if (a.normViolation >= 0.2) {
      const open = creature.openCommitments(1).filter(c => !c.broken)
      if (open.length > 0) {
        const lines = open.map((c, i) => `${i}. ${c.text}`).join('\n')
        const raw = await chat(
          [{ role: 'system', content: BROKEN_SYSTEM_PROMPT }, { role: 'user', content: `未完成承诺：\n${lines}\n\n最近对话：\n${transcript.slice(-800)}` }],
          { json: true, maxTokens: 60 },
        )
        const idx = parseBroken(raw, open.length)
        if (idx !== null) {
          creature.resolveCommitment(open[idx].id, 'broken')
          console.log(`  → 违诺: ${open[idx].text}`)
        }
      }
    }

    if (shouldConsolidate({ episodesSince: cnt.episodesSince, salienceSince: cnt.salienceSince, sinceLast: cnt.sinceLast, g: 1 })) {
      cnt = { episodesSince: 0, salienceSince: 0, sinceLast: 0 }
      const events = creature.store.readEvents()
      const episodes = events.filter(e => e.t === 'episode').slice(-8)
      const existing = creature.memorySummary(1)
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
  }

  console.log('\n════ 承诺事件 ════')
  for (const e of creature.store.readEvents()) {
    if (e.t === 'commitment') console.log(`  [commitment] ${e.text}`)
    if (e.t === 'commitment-resolved') console.log(`  [resolved] ${e.ref.slice(0, 8)} → ${e.status}`)
  }

  const memory = creature.memorySummary(1)
  console.log('\n════ 注入示例 ════')
  const affect = creature.fold().affect
  const bias = toBias(affect, creature.temperament)
  console.log(summaryText(bias, affect, memory))
}

main().catch((err) => {
  console.error('冒烟失败：', err)
  process.exit(1)
})
