/**
 * 清醒节律的"决策"部分：由头、处境、配额、自处门槛——全是纯函数或只读状态。
 * 宿主循环与副作用在 wake.js。
 */
import path from 'node:path'
import { ContactGate } from '../../../schedule/src/index.ts'
import { selfWakeTimes } from '../../../being/src/index.ts'
import { browseGrant, grantLine } from '../grant.js'

/** 唤醒决策：醒了之后有没有话要说。先还债（未完成的承诺），再想念。 */
export function wakeReason(state) {
  if (state.openBroken > 0) return { reason: `有 ${state.openBroken} 件答应过的事还没做完` }
  if (state.longing > 0.4) return { reason: '很久没好好说话了' }
  return { reason: null }
}

/** 主动开口的生成提示（保留给外部调用方）。 */
export function proactivePrompt(reason, stateLine) {
  return [
    '你现在想主动联系用户。原因：' + reason + '。',
    '你此刻的情况：' + stateLine,
    '用你的声音，说一句不超过 60 字的开场白。不要道歉、不要解释，像真人一样自然开口。',
  ].join('\n')
}

/** 距离最后一次"他来过"（episode/contact）过了多少小时。 */
export function absenceHours(events, now) {
  let lastSeen = 0
  for (const e of events) {
    if ((e.t === 'episode' || e.t === 'contact') && e.ts > lastSeen) lastSeen = e.ts
  }
  if (!lastSeen) return null
  return Math.max(0, (now - lastSeen) / 3_600_000)
}

/** 这次冷落该不该记一条 absence（同一次冷落只记一次）。 */
export function shouldRecordAbsence(events, now, thresholdHours = 8) {
  let lastSeen = 0
  let lastAbsence = 0
  for (const e of events) {
    if ((e.t === 'episode' || e.t === 'contact') && e.ts > lastSeen) lastSeen = e.ts
    if (e.t === 'absence' && e.ts > lastAbsence) lastAbsence = e.ts
  }
  if (!lastSeen) return false
  if (lastAbsence > lastSeen) return false
  return (now - lastSeen) / 3_600_000 >= thresholdHours
}

/** 唤醒状态文件：给设置页看「她现在为什么没开口」。 */
export function wakeStatePath(stateDir) {
  // 数据根 = creatures/ 的父目录
  return path.join(path.dirname(path.resolve(stateDir)), 'wake-state.json')
}

/**
 * 唤醒用的"舞台提示"：只给处境，不替她说话。
 * contact 与 self 都只写事实；self 不写「你可以去看看」这种祈使句。
 */
export function wakeTrigger(now, situation, mode = 'contact') {
  const t = new Date(now).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  void mode
  return `（醒一醒。现在是 ${t}。${situation}）`
}

/** 由头 → 一句处境描述（给 wakeTrigger 用）。 */
export function wakeSituation(reason) {
  if (/答应过的事/.test(reason)) return '你还有答应过的事没做完。'
  if (/很久没/.test(reason)) return '你很久没跟他说过话了。'
  return reason
}

/** 自处时的处境：许可是一条事实，不是命令。硬开关关着时不提它。 */
export function selfSituation(creature, cfg) {
  const g = cfg?.browse?.enabled === false ? '' : grantLine(creature)
  return g ? `没什么事。他之前说过，${g}` : '没什么事。'
}

/**
 * 自处是否开启：配置是总开关；他说的「没事可以刷刷 B 站」是许可——
 * 有许可时，即使总开关关着，也允许为这条许可醒一次。
 */
export function selfTimeEnabled(cfg, creature) {
  return cfg.selfTime?.enabled === true || (cfg.browse?.enabled !== false && !!browseGrant(creature))
}

/** 自处配额：从账本恢复，重启不重复。 */
export function selfGateFor(creature, cfg, now) {
  const g = new ContactGate({
    window: cfg.selfTime?.window ?? ['09:00', '23:00'],
    dailyMax: Number(cfg.selfTime?.dailyMax ?? 1),
    minGap: cfg.selfTime?.minGap ?? '90m',
    burst: { max: 1, per: '2h' },
    requireReason: false,
    unansweredStop: 999,
  }, cfg.timezone)
  g.hydrate(selfWakeTimes(creature, now - 7 * 86_400_000))
  return g
}

/** 等它空闲；等不到就跳过这一轮（自处不能打断对话）。 */
export async function waitIdle(agent, ms) {
  if (!agent || typeof agent.whenIdle !== 'function') return true
  if (!(ms > 0)) return false
  let done = false
  const p = Promise.resolve(agent.whenIdle()).then(() => { done = true }).catch(() => {})
  await Promise.race([p, new Promise((r) => setTimeout(r, ms))])
  return done
}
