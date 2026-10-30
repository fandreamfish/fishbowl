/**
 * 会话事件 → 转录文本。
 * 字段形状依据 dsh-session 的 surface 投影（surface.js `deriveEventMessage`）：
 *   user/message      的 data 本身就是消息 { role, id, content, source }
 *   assistant/message 的消息在 data.message
 *   tool/result       的消息也在 data.message
 */

/** @returns {any} 事件携带的消息对象，取不到返回 null */
export function messageOf(event) {
  const d = event?.data
  if (!d) return null
  if (event.type === 'user/message') return d
  return d.message ?? null
}

/** @param {any} message */
export function messageText(message) {
  if (!message) return ''
  if (typeof message.content === 'string') return message.content
  if (!Array.isArray(message.content)) return ''
  return message.content
    .map((b) => {
      if (typeof b === 'string') return b
      if (b && typeof b.text === 'string') return b.text
      if (b && typeof b.content === 'string') return b.content
      return ''
    })
    .filter((s) => s.trim() !== '')
    .join(' ')
}

export function textOf(event) {
  return messageText(messageOf(event))
}

export function toolNameOf(event) {
  const d = event?.data
  if (!d) return ''
  if (typeof d.toolName === 'string') return d.toolName
  if (typeof d.name === 'string') return d.name
  if (typeof d.tool === 'string') return d.tool
  if (Array.isArray(d.message?.content)) {
    for (const b of d.message.content) {
      if (b && typeof b.toolName === 'string') return b.toolName
    }
  }
  return ''
}

/** 自己注入的状态块不算对话内容——否则会污染下一轮的转录与评价。 */
export function isFishbowlInjection(event) {
  return event?.type === 'user/message' && event?.data?.source?.kind === 'fishbowl'
}
