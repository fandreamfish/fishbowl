/**
 * OneBot v11 客户端：WebSocket 收事件 + HTTP 发消息。
 * 事件解析是纯函数（可测）。
 */

/** 解析一条 OneBot 事件为可回复的消息；不回复的返回 null。 */
export function parseMessageEvent(ev, selfId) {
  if (!ev || ev.post_type !== 'message') return null
  if (ev.message_type === 'private') {
    return {
      channel: 'qq-private',
      to: String(ev.user_id ?? ''),
      text: String(ev.raw_message ?? ev.message ?? '').trim(),
      isGroup: false,
    }
  }
  if (ev.message_type === 'group') {
    const at = `[CQ:at,qq=${selfId}]`
    const raw = String(ev.raw_message ?? ev.message ?? '')
    if (!raw.includes(at)) return null // 群里只回应 @ 她的
    return {
      channel: 'qq-group',
      to: String(ev.group_id ?? ''),
      text: raw.split(at).join('').trim(),
      isGroup: true,
    }
  }
  return null
}

export class OneBot {
  /** @param {{wsUrl: string, httpUrl: string}} cfg */
  constructor(cfg) {
    this.cfg = cfg
    this.ws = null
  }

  async connect(onEvent) {
    const ws = new WebSocket(this.cfg.wsUrl)
    this.ws = ws
    ws.addEventListener('message', (e) => {
      try {
        onEvent(JSON.parse(String(e.data)))
      } catch { /* 坏事件忽略 */ }
    })
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', () => reject(new Error('ws connect failed')), { once: true })
    })
  }

  async _send(action, params) {
    const res = await fetch(`${this.cfg.httpUrl.replace(/\/+$/, '')}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`onebot ${action} http ${res.status}`)
    return res.json()
  }

  sendPrivate(userId, text) {
    return this._send('send_private_msg', { user_id: Number(userId), message: text })
  }

  sendGroup(groupId, text) {
    return this._send('send_group_msg', { group_id: Number(groupId), message: text })
  }
}
