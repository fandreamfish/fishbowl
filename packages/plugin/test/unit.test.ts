/** 插件单元测试：评价器、注入摘要、约束决策、会话↔个体绑定。 */
import fs from 'node:fs'
import path from 'node:path'
import { parseConsolidation, shouldConsolidate } from '../../../src/core/consolidation.ts'
import * as sc from '../../../src/scenarios.ts'
import { appraiseScripted } from '../lib/appraiser.js'
import { createBinding } from '../lib/binding.js'
import { normalizeConfig } from '../lib/config.js'
import { refuseReason, verifyDecision } from '../lib/constraints.js'
import { isFishbowlInjection, messageText, textOf, toolNameOf } from '../lib/extract.js'
import { IDENTITY_RE, parseIdentity } from '../lib/identity.js'
import { injectMessage, stateKey, summaryText } from '../lib/injector.js'
import { VOICE_RULES } from '../lib/voice.js'

let failures = 0
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? '  ' + detail : ''}`)
  if (!cond) failures++
}

const stateDir = path.join(process.cwd(), 'test-tmp', 'plugin')
const cfg = normalizeConfig({ stateDir })

console.log('== 评价器（关键词版） ==')
const rej = appraiseScripted('这个方案不行，重做。')
check('否定 → goalCongruence -0.45', Math.abs(rej.goalCongruence + 0.45) < 1e-9, `gc=${rej.goalCongruence}`)
const sorry = appraiseScripted('抱歉，是我的错，我保证下次不会了。')
check('道歉 → 自归因 + 违诺', sorry.attribution === 'self' && sorry.normViolation > 0,
  `att=${sorry.attribution} nv=${sorry.normViolation}`)
const praise = appraiseScripted('谢谢，做得很好，我很喜欢。')
check('夸奖 → 正向关系影响', praise.relationalImpact > 0, `ri=${praise.relationalImpact}`)
const plain = appraiseScripted('下午三点开会。')
check('中性 → 全默认', plain.goalCongruence === 0 && plain.normViolation === 0 && plain.attribution === 'circumstance')

console.log('== 注入摘要 ==')
const bias = { verbosity: 0.14, thresholdRefuse: 0.23, thresholdVerify: 0.78, riskAppetite: 0.83, disclosure: 0.30, patience: 0.17 }
const affect = { valence: -0.68, arousal: 0.74, guilt: 0.6, longing: 0, mood: 0, named: {} }
const summary = summaryText(bias, affect)
check('包含六个旋钮数值', ['0.14', '0.23', '0.78', '0.83', '0.30', '0.17'].every(v => summary.includes(v)))
check('愧疚以事实形式出现', summary.includes('未平复的愧疚'))
check('不含情绪台词', !summary.includes('难过') && !summary.includes('生气'))
check('明示"影响怎么做"', summary.includes('怎么做，而不是怎么说'))
check('声明快照≠人格（防自我叙事固化）', summary.includes('不是人格') && summary.includes('照实说还不确定'))
check('状态摘要不含声音规则（声音走独立机制）', !summary.includes('不表演认错'))

console.log('== 声音规则（few-shot 语域） ==')
check('禁止表演式认错', VOICE_RULES.includes('不表演认错'))
check('包含真实对话样例', VOICE_RULES.includes('哪不行？说具体点，我改。'))
check('禁止自我剖析', VOICE_RULES.includes('不分析自己'))

console.log('== 注入消息形状（事故回归测试） ==')
const m1 = injectMessage('hello')
const m2 = injectMessage('hello')
check('role 必须是 user', m1.role === 'user')
check('id 是合法 UUID 且每次不同',
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(m1.id ?? '') && m1.id !== m2.id)
check('content 是 text 块', m1.content?.[0]?.type === 'text' && m1.content?.[0]?.text === 'hello')
check('source 标记 fishbowl', m1.source?.kind === 'fishbowl')

console.log('== 事件提取（真机字段形状回归） ==')
const userEv = { type: 'user/message', data: { role: 'user', id: 'x', content: [{ type: 'text', text: '你好' }], source: { kind: 'user' } } }
const asstEv = { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: '好的' }] } } }
const toolEv = { type: 'tool/result', data: { message: { role: 'tool', content: [{ type: 'text', text: 'ok' }] }, toolName: 'bash' } }
check('user/message：data 即消息', textOf(userEv) === '你好')
check('assistant/message：文本在 data.message（真机 bug 修复点）', textOf(asstEv) === '好的')
check('tool/result：文本在 data.message', textOf(toolEv) === 'ok')
check('tool 名字优先 data.toolName', toolNameOf(toolEv) === 'bash')
check('tool 名字回退 content 块', toolNameOf({ type: 'tool/result', data: { message: { content: [{ toolName: 'pwsh' }] } } }) === 'pwsh')
check('messageText 忽略空块', messageText({ content: [{ type: 'text', text: '' }, { type: 'text', text: 'hi' }] }) === 'hi')
check('自己注入的状态块被识别', isFishbowlInjection({ type: 'user/message', data: { source: { kind: 'fishbowl' } } }) === true)
check('普通用户消息不算注入', isFishbowlInjection(userEv) === false)

console.log('== 状态指纹（防每轮重复注入） ==')
const baseBias = { verbosity: 0.5, thresholdRefuse: 0.5, thresholdVerify: 0.5, riskAppetite: 0.5, disclosure: 0.5, patience: 0.5 }
const baseAff = { valence: -0.03, arousal: 0.67, guilt: 0, longing: 0, mood: 0, named: {} }
check('0.001 级漂移被吸收', stateKey(baseBias, { ...baseAff, valence: -0.029 }) === stateKey(baseBias, baseAff))
check('0.1 级变化触发新指纹', stateKey(baseBias, { ...baseAff, valence: -0.63 }) !== stateKey(baseBias, baseAff))
check('旋钮 0.1 级变化触发新指纹', stateKey({ ...baseBias, verbosity: 0.2 }, baseAff) !== stateKey(baseBias, baseAff))
check('愧疚出现触发新指纹', stateKey(baseBias, { ...baseAff, guilt: 0.6 }) !== stateKey(baseBias, baseAff))

console.log('== M2：巩固与身份 ==')
check('g=1：5 轮触发', shouldConsolidate({ episodesSince: 5, salienceSince: 0, g: 1 }))
check('g=1：4 轮不触发', !shouldConsolidate({ episodesSince: 4, salienceSince: 0, g: 1 }))
check('g=2：3 轮触发（成长更快）', shouldConsolidate({ episodesSince: 3, salienceSince: 0, g: 2 }))
check('高显著度单轮触发', shouldConsolidate({ episodesSince: 1, salienceSince: 0.7, g: 1 }))
const pc = parseConsolidation('{"semantics":[{"claim":"他喜欢猫","evidence":["1","2"],"confidence":0.8}],"procedures":[{"trigger":"他说不行","action":"先问清楚","evidence":["3"],"confidence":0.7}]}')
check('巩固解析：语义与教训', pc.semantics.length === 1 && pc.procedures.length === 1 && pc.semantics[0].claim === '他喜欢猫')
check('巩固解析：垃圾输入得空数组', parseConsolidation('垃圾').semantics.length === 0)
check('巩固解析：语义上限 3', parseConsolidation('{"semantics":[{"claim":"a"},{"claim":"b"},{"claim":"c"},{"claim":"d"}]}').semantics.length === 3)
check('身份正则预筛', IDENTITY_RE.test('我给你起个名字叫大肥鱼') && !IDENTITY_RE.test('今天天气不错'))
check('身份解析', parseIdentity('{"named":true,"name":"大肥鱼"}') === '大肥鱼')
check('身份解析：未命名 → null', parseIdentity('{"named":false}') === null)

const named = createBinding(cfg).creatureFor('session-m2-named')
named.recordIdentity('大肥鱼')
check('起名：meta 更新 + 事件落盘', named.meta.name === '大肥鱼'
  && named.store.readEvents().some((e: any) => e.t === 'identity'))
named.recordSemantic('他喜欢猫', ['1', '2'], 0.8, 0)
named.recordProcedure('他说不行', '先问清楚', ['3'], 0.7, 0)
const ms = named.memorySummary()
check('记忆摘要：名字 + 语义 + 教训', ms.name === '大肥鱼'
  && ms.semantics.includes('他喜欢猫') && ms.procedures.includes('他说不行 → 先问清楚'))
const namedSummary = summaryText(baseBias, baseAff, ms)
check('注入含名字与记忆', namedSummary.includes('大肥鱼')
  && namedSummary.includes('记得的事') && namedSummary.includes('教训'))
check('未起名个体不含名字行', !summaryText(baseBias, baseAff, { name: null, semantics: [], procedures: [] }).includes('名字:'))
check('记忆变化触发新指纹', stateKey(baseBias, baseAff, { name: '大肥鱼', semantics: ['x'], procedures: [] })
  !== stateKey(baseBias, baseAff, { name: null, semantics: [], procedures: [] }))

console.log('== 工具约束（纯决策函数） ==')
const hot = { verbosity: 0.5, thresholdRefuse: 0.1, thresholdVerify: 0.78, riskAppetite: 0.5, disclosure: 0.5, patience: 0.5 }
check('高验证门槛 → bash 先 ask', verifyDecision(hot, 'bash', cfg)?.kind === 'ask')
check('低验证门槛 → 放行', verifyDecision({ ...hot, thresholdVerify: 0.3 }, 'bash', cfg) === null)
check('非名单工具 → 放行', verifyDecision(hot, 'read', cfg) === null)
const strict = normalizeConfig({ stateDir, refuseTools: ['bash'] })
check('低拒绝门槛 → 拒绝破坏性工具', (refuseReason({ ...hot, thresholdRefuse: 0.1 }, 'bash', strict) ?? '').includes('拒绝'))
check('高拒绝门槛 → 放行', refuseReason({ ...hot, thresholdRefuse: 0.5 }, 'bash', strict) === null)
check('对照组 control=true 时约束关闭', normalizeConfig({ stateDir, control: true }).control === true)

console.log('== 会话 ↔ 个体绑定 ==')
const binding = createBinding(cfg)
const c1 = binding.creatureFor('session-a')
const c2 = binding.creatureFor('session-a')
const other = binding.creatureFor('session-b')
check('同一会话绑定同一个体', c1.meta.creatureId === c2.meta.creatureId)
check('不同会话是不同个体', c1.meta.creatureId !== other.meta.creatureId)
check('气质是随机的（不写死在代码里）', typeof c1.meta.temperament.reactivity === 'number'
  && c1.meta.temperament.reactivity >= 0.6 && c1.meta.temperament.reactivity <= 1.4)
check('时区写入 meta（搬迁不变量）', c1.meta.timezone === cfg.timezone)
check('模型随个体绑定', c1.meta.model.pinned === true)

const T0 = 0
for (let i = 0; i < 3; i++) c1.recordEpisode('rejected', sc.rejection(), undefined, T0)
check('三连否定后耐心显著下降', c1.bias().patience < 0.30, `pati=${c1.bias().patience.toFixed(2)}`)
check('个体目录已落盘', fs.existsSync(path.join(stateDir, c1.meta.creatureId, 'log.ndjson')))
check('绑定表已落盘', fs.existsSync(path.join(stateDir, 'bindings.json')))

console.log('== 配置默认值 ==')
const d = normalizeConfig({})
check('默认时区 Asia/Shanghai', d.timezone === 'Asia/Shanghai')
check('默认评价器 scripted（离线可用）', d.appraiser.kind === 'scripted')
check('默认状态目录在用户目录下（不进仓库）', d.stateDir.includes('.fishbowl'))

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`)
process.exit(failures === 0 ? 0 : 1)
