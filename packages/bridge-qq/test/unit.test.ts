/** OneBot 事件解析测试（纯函数）。 */
import { parseMessageEvent } from '../lib/onebot.js'

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

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`)
process.exit(failures === 0 ? 0 : 1)
