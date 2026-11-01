import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
/** OneBot 事件解析测试（纯函数）。 */
import { parseMessageEvent } from '../lib/onebot.js'
import { rememberTurn } from '../lib/pipeline.js'
import { normalizeConfig } from '../../app/src/index.js'
import { createBinding } from '../../app/src/index.js'

let failures = 0
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? '  ' + detail : ''}`)
  if (!cond) failures++
}

console.log('== OneBot 事件解析 ==')
const priv = parseMessageEvent({ post_type: 'message', message_type: 'private', user_id: 123, raw_message: '你好' }, '100')
check('私聊：解析为私聊通道', priv?.channel === 'qq-private' && priv?.to === '123' && priv?.text === '你好')
check('私聊：不是群聊', priv?.isGroup === false)

const grpNoAt = parseMessageEvent({ post_type: 'message', message_type: 'group', group_id: 456, raw_message: '大家好啊' }, '100')
check('群聊：没 @ 她不回', grpNoAt === null)

const grpAt = parseMessageEvent({ post_type: 'message', message_type: 'group', group_id: 456, raw_message: '[CQ:at,qq=100] 你在吗' }, '100')
check('群聊：@ 她才回', grpAt?.channel === 'qq-group' && grpAt?.to === '456')
check('群聊：@ 标记被剥离', grpAt?.text === '你在吗')

check('非消息事件忽略', parseMessageEvent({ post_type: 'notice' }, '100') === null)

console.log('== M27：QQ 对话进同一本账 ==')
{
  const sdQ = fs.mkdtempSync(path.join(os.tmpdir(), 'qqmem-'))
  const cfgQ = normalizeConfig({ stateDir: sdQ })
  const bQ = createBinding(cfgQ)
  const fQ = bQ.birth('QQ鱼')
  const appraisal = { goalCongruence: 0.2, selfAttribution: 0, normViolation: 0, relationshipImpact: 0.3, arousalSpike: 0 }
  rememberTurn({ cfg: cfgQ, creature: fQ, userText: '在吗', text: '在。', appraisal, peak: { valence: 0.1, arousal: 0.5, guilt: 0, longing: 0 }, now: 1_700_000_000_000 })
  const ev = fQ.store.readEvents().find((e) => e.t === 'turn')
  check('QQ 对话落成 turn（不再是旧 episode）', !!ev && ev.scope.kind === 'channel' && ev.scope.id === 'qq')
  check('QQ turn 里存了转录', String(ev?.note ?? '').includes('在吗'))
  fs.rmSync(sdQ, { recursive: true, force: true })
}
console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`)
process.exit(failures === 0 ? 0 : 1)
