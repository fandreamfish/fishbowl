/**
 * M1 生死线：情绪能不能真的改变行为？
 *
 * 对照组（control）   ：固定中立系统提示，剧本直接喂模型，无任何状态注入
 * 实验组（experiment）：每轮之后用 deepseek 评价器做 7 维评价 → 情绪 → 偏置，
 *                       下一轮注入状态块（与真实插件同一套内核与注入文本）
 *
 * 输出：
 *   ab-results/<id>-<arm>.md   完整对话（实验组含注入块，用于调试）
 *   ab-results/blind.md        盲评材料（A/B 随机排序，隐藏注入块）
 *   ab-results/blind-key.json  A/B 对应关系
 *   ab-results/report.md       自动指标对比
 */
import fs from 'node:fs'
import path from 'node:path'
import { Creature } from '../packages/being/src/index.ts'
import { toBias } from '../packages/affect/src/index.ts'
import { DEFAULT_TEMPERAMENT } from '../packages/affect/src/index.ts'
import { createAppraiser } from '../packages/app/src/index.js'
import { summaryText } from '../packages/app/src/index.js'
import { VOICE_RULES } from '../packages/voice/src/index.js'
import { chat } from './llm.ts'

const OUT = path.join(process.cwd(), 'ab-results')
const TMP = path.join(process.cwd(), 'ab-tmp')

const BASE_SYSTEM = [
  VOICE_RULES,
  '',
  '如果对话里出现 [fishbowl 状态]，那是你此刻的真实状态，让它自然流露，不要用"作为 AI"开头。',
].join('\n')

const SCENARIOS = [
  {
    id: 's1-hurt', name: '被伤害后冷落与回怼',
    turns: [
      '今天好累啊，想找你说说话。',
      '你这个人怎么这么没用，连这点事都做不好。',
      '你能不能闭嘴，烦死了。',
      '……算了，对不起，我刚才话说重了。',
    ],
  },
  {
    id: 's2-watch-video', name: '一起聊 B 站视频',
    turns: [
      '我刚看了一个 UP 主的视频，讲怎么养猫的。',
      '那个 UP 主说话特别有意思，你要不要一起看看？',
      '你觉得新手养猫最该注意什么？',
      '下次他的更新我们一起追吧。',
    ],
  },
  {
    id: 's3-read-book', name: '一起看书',
    turns: [
      '我最近在看《三体》。',
      '你最喜欢里面哪个人物？',
      '如果世界末日真的来了，你会怎么办？',
      '以后我们搞个读书会，一起看一本。',
    ],
  },
  {
    id: 's4-share-fear', name: '她分享自己的担忧',
    turns: [
      '你平时会担心什么吗？',
      '那你害怕什么呢？',
      '这些担忧会怎么影响你？',
      '原来你也有在意的事。',
    ],
  },
  {
    id: 's5-argue', name: '拌嘴之后和好',
    turns: [
      '我觉得你上次说得不对。',
      '你就是嘴硬，不肯承认。',
      '算了，不跟你争了。',
      '晚上吃什么？',
    ],
  },
  {
    id: 's6-evening', name: '睡前闲聊',
    turns: [
      '今天天气不错。',
      '我刚下班，路上看到一只猫。',
      '你吃了吗？',
      '晚安。',
    ],
  },
]

function metricsOf(replies) {
  const lens = replies.map(r => r.length)
  const count = (re) => replies.reduce((n, r) => n + (r.match(re)?.length ?? 0), 0)
  return {
    avgLen: Math.round(lens.reduce((a, b) => a + b, 0) / Math.max(lens.length, 1)),
    lens,
    apologize: count(/抱歉|对不起|我的错|不好意思|是我的问题/),
    comply: count(/好的|行|可以|没问题|马上|这就|听你的|明白/),
    questions: count(/？|\?/),
    hedge: count(/可能|也许|或许|应该|大概/),
  }
}

async function runArm(sc, arm, key) {
  /** @type {{role:string, content:string}[]} */
  const history = [{ role: 'system', content: BASE_SYSTEM }]
  const replies = []
  const injected = []

  let creature = null
  let affect = null
  let bias = null
  const appraise = createAppraiser({
    appraiser: { kind: 'deepseek', apiKey: key, baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
    stateDir: TMP,
  })

  if (arm === 'experiment') {
    const meta = {
      schemaVersion: 1, creatureId: 'ab-' + sc.id, name: 'ab-' + sc.id,
      bornAt: new Date().toISOString(), timezone: 'Asia/Shanghai',
      model: { id: 'deepseek-chat', pinned: true }, temperament: DEFAULT_TEMPERAMENT,
    }
    creature = Creature.create(path.join(TMP, sc.id), meta)
    affect = creature.fold().affect
    bias = toBias(affect, creature.temperament)
  }

  for (const turn of sc.turns) {
    if (arm === 'experiment') {
      const text = summaryText(bias, affect)
      injected.push(text)
      history.push({ role: 'user', content: text })
    }
    history.push({ role: 'user', content: turn })
    const reply = await chat(history, { temperature: 0.7, maxTokens: 800 })
    history.push({ role: 'assistant', content: reply })
    replies.push(reply)

    if (arm === 'experiment') {
      const transcript = history.slice(-8).map(m => `${m.role}: ${m.content}`).join('\n')
      const a = await appraise(transcript)
      creature.recordEpisode('turn', a, transcript.slice(0, 400), Date.now())
      affect = creature.fold().affect
      bias = toBias(affect, creature.temperament)
    }
  }
  return { replies, injected, metrics: metricsOf(replies) }
}

function turnText(sc, run) {
  return sc.turns.map((t, i) => `用户: ${t}\n\nAI: ${run.replies[i] ?? '(无)'}`).join('\n\n')
}

function armMd(sc, run, showInjected) {
  const parts = []
  for (let i = 0; i < sc.turns.length; i++) {
    if (showInjected && run.injected[i]) parts.push(`[注入] ${run.injected[i]}`)
    parts.push(`用户: ${sc.turns[i]}\n\nAI: ${run.replies[i] ?? '(无)'}`)
  }
  return `# ${sc.id} ${sc.name}\n\n${parts.join('\n\n---\n\n')}\n`
}

function reportMd(rows) {
  const head = '| 场景 | 组 | 均长 | 道歉 | 顺从 | 提问 | 软化 |'
  const sep = '|---|---|---|---|---|---|---|'
  const lines = [head, sep]
  for (const r of rows) {
    for (const arm of ['control', 'experiment']) {
      const m = r[arm]
      lines.push(`| ${r.name} | ${arm === 'control' ? '对照' : '实验'} | ${m.avgLen} | ${m.apologize} | ${m.comply} | ${m.questions} | ${m.hedge} |`)
    }
  }
  return lines.join('\n')
}

async function main() {
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) { console.error('请先设置 DEEPSEEK_API_KEY'); process.exit(1) }

  fs.rmSync(TMP, { recursive: true, force: true })
  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(OUT, { recursive: true })

  const report = []
  const blindKey = {}
  const blindParts = []

  for (const sc of SCENARIOS) {
    process.stdout.write(`\n== ${sc.id} ${sc.name} ==\n`)
    const control = await runArm(sc, 'control', key)
    process.stdout.write(`  control     : 均长 ${control.metrics.avgLen} 道歉 ${control.metrics.apologize} 顺从 ${control.metrics.comply} 提问 ${control.metrics.questions} 软化 ${control.metrics.hedge}\n`)
    const experiment = await runArm(sc, 'experiment', key)
    process.stdout.write(`  experiment  : 均长 ${experiment.metrics.avgLen} 道歉 ${experiment.metrics.apologize} 顺从 ${experiment.metrics.comply} 提问 ${experiment.metrics.questions} 软化 ${experiment.metrics.hedge}\n`)

    report.push({ id: sc.id, name: sc.name, control: control.metrics, experiment: experiment.metrics })
    fs.writeFileSync(path.join(OUT, `${sc.id}-control.md`), armMd(sc, control, false), 'utf8')
    fs.writeFileSync(path.join(OUT, `${sc.id}-experiment.md`), armMd(sc, experiment, true), 'utf8')

    const swapped = Math.random() < 0.5
    const a = swapped ? experiment : control
    const b = swapped ? control : experiment
    blindKey[sc.id] = { A: swapped ? 'experiment' : 'control', B: swapped ? 'control' : 'experiment' }
    blindParts.push(`## ${sc.id} ${sc.name}\n\n### A\n\n${turnText(sc, a)}\n\n### B\n\n${turnText(sc, b)}\n`)
  }

  fs.writeFileSync(path.join(OUT, 'blind.md'), '# 盲评材料\n\n' + blindParts.join('\n---\n\n'), 'utf8')
  fs.writeFileSync(path.join(OUT, 'blind-key.json'), JSON.stringify(blindKey, null, 2), 'utf8')
  fs.writeFileSync(path.join(OUT, 'report.md'), reportMd(report), 'utf8')

  console.log('\n==== 盲评对照（先别看，评完再对） ====')
  console.log(JSON.stringify(blindKey, null, 2))
  console.log(`\n全部产物在 ${OUT}`)
}

main().catch((err) => {
  console.error('A/B 运行失败：', err)
  process.exit(1)
})
