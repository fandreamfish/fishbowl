/**
 * 账本上的几个小动作：许可、醒来、以及「只要对话行」。
 *
 * 为什么单独一个文件：这些函数要被插件在**已经缓存过 creature.ts** 的进程里调用。
 * 往 Creature 类上加新方法/新导出，DSH 热启用时看不到（模块缓存），
 * 所以插件侧只依赖这个新模块；Creature 上的同名方法保留给测试与外部调用。
 */
import { uid } from './util.ts'

/**
 * 只要对话行。
 * `turn.note` 可能带 `situation:`（她醒来的处境）和 `tool:`（工具结果），
 * 这两类不是"你们说过的话"；原样塞回注入/检索会让她以为对方说过那些。
 */
export function dialogOnly(note: string): string {
  const raw = String(note ?? '')
  const lines = raw.split('\n')
  const dialog = lines.filter((line) => /^(user|assistant):/.test(line))
  // 旧 episode 的 note 没有角色前缀（整段就是原话）；有前缀才按行过滤。
  return (dialog.length ? dialog.join('\n') : raw).trim()
}

/** 最近的对话（过滤 situation/tool）。 */
export function recentDialog(creature: any, limit = 6): { ts: number; text: string }[] {
  const out: { ts: number; text: string }[] = []
  for (const e of creature.store.readEvents()) {
    if ((e.t === 'episode' || e.t === 'turn') && typeof e.note === 'string') {
      const text = dialogOnly(e.note)
      if (text) out.push({ ts: e.ts, text })
    }
  }
  return out.slice(-limit)
}

/** 一次醒来（联系型 / 自处型）。 */
export function recordWake(creature: any, mode: 'contact' | 'self', reason?: string | null, ts?: number): void {
  creature.store.appendEvent({
    t: 'wake', id: uid(), ts: ts ?? Date.now(),
    mode: mode === 'self' ? 'self' : 'contact',
    reason: reason ?? null,
  })
}

/** 自处型醒来的时间（配额跨重启）。 */
export function selfWakeTimes(creature: any, since = 0): number[] {
  return creature.store
    .readEvents()
    .filter((e: any) => e.t === 'wake' && e.mode === 'self' && e.ts >= since)
    .map((e: any) => e.ts)
    .sort((a: number, b: number) => a - b)
}

/** 他说了一句「允许/不允许」。 */
export function recordGrant(creature: any, topic: string, text: string, allowed = true, ts?: number): void {
  creature.store.appendEvent({
    t: 'grant', id: uid(), ts: ts ?? Date.now(),
    topic: String(topic ?? 'browse').slice(0, 40),
    text: String(text ?? '').slice(0, 300),
    allowed: allowed !== false,
  })
}

/** 当前有效的许可（同一 topic 以最后一条为准）。 */
export function activeGrants(creature: any, topic?: string): { topic: string; text: string; ts: number }[] {
  const last = new Map<string, any>()
  for (const e of creature.store.readEvents()) {
    if (e.t !== 'grant') continue
    if (topic && e.topic !== topic) continue
    last.set(e.topic, e)
  }
  return [...last.values()]
    .filter((e) => e.allowed !== false)
    .map((e) => ({ topic: e.topic, text: e.text, ts: e.ts }))
}
