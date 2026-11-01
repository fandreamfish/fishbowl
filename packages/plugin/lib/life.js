/**
 * 清醒节律：联系型（想找他）与自处型（自己待着）。
 *
 * 一次 tick 只做一个决定：
 *   有联系由头 + 联系闸通过 → 联系型唤醒
 *   否则 自处到点 + 自处闸通过 → 自处型唤醒
 *   否则 → 继续睡
 *
 * 自处型不记 outreach、不吃联系配额；提示只给处境，不写祈使句。
 * 上网不在这里预取素材：她醒着，自己决定要不要调用 fish_bili_look。
 */
import { ContactGate } from '../../../src/core/contact.ts'
import { Scheduler } from '../../../src/core/scheduler.ts'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createDshHost, workspaceOf } from '../host/dsh.js'
import { configFor } from './fishcfg.js'
import { injectMessage } from './injector.js'
import { browseGrant, grantLine } from './grant.js'
import { browseDayKey } from '../../../src/core/browse.ts'
import { recordWake, selfWakeTimes } from '../../../src/core/signals.ts'
import { countToday } from './browse/store.js'
import { markReplySeen, scanDueReplies } from './browse/comment.js'
import { markSelfTime } from './browse/runtime.js'

/**
 * 唤醒决策：醒了之后有没有话要说。
 * 由头必须来自她自己的事：先还债（未完成的承诺），再想念（缺席累积）。
 */
export function wakeReason(state) {
  if (state.openBroken > 0) return { reason: `有 ${state.openBroken} 件答应过的事还没做完` }
  if (state.longing > 0.4) return { reason: '很久没好好说话了' }
  return { reason: null }
}

/** 主动开口的生成提示（保留：L1 之前的外部调用方可能还在用）。 */
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
  return path.join(stateDir, 'wake-state.json')
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
 * 自处是否开启。
 * 配置是总开关；他说的「没事可以刷刷 B 站」是许可——有许可时，
 * 即使自处总开关关着，也允许为这条许可醒一次。撤销后回到总开关。
 */
export function selfTimeEnabled(cfg, creature) {
  // 硬开关关着时，许可也不该让她为一个打不开的门醒来；自处总开关仍然可以为写日记等打开。
  return cfg.selfTime?.enabled === true || (cfg.browse?.enabled !== false && !!browseGrant(creature))
}

/** 自处配额：从账本恢复，重启不重复。 */
function selfGateFor(creature, cfg, now) {
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
async function waitIdle(agent, ms) {
  if (!agent || typeof agent.whenIdle !== 'function') return true
  if (!(ms > 0)) return false
  let done = false
  const p = Promise.resolve(agent.whenIdle()).then(() => { done = true }).catch(() => {})
  await Promise.race([p, new Promise((r) => setTimeout(r, ms))])
  return done
}

export function createWakeLoop(ctx, binding, cfg, host) {
  host = host ?? createDshHost(ctx, cfg)
  if (!cfg.wake?.enabled) return () => {}

  const scheduler = new Scheduler(cfg.wake, cfg.timezone)
  const gates = new Map() // creatureId -> ContactGate（联系）
  let timer = null
  let stopped = false

  function gateFor(creature, fcfg, now) {
    const cid = creature.meta.creatureId
    let g = gates.get(cid)
    if (!g || g.cfg !== fcfg.contact) {
      g = new ContactGate(fcfg.contact, cfg.timezone)
      gates.set(cid, g)
    }
    g.hydrate(creature.outreachTimes(now - 7 * 86_400_000))
    return g
  }

  function traceWake(sessionId, creatureId, mode, reason) {
    try {
      fs.appendFileSync(path.join(cfg.stateDir, 'trace.ndjson'), JSON.stringify({
        ts: Date.now(), sessionId, creatureId, event: 'wake', mode, reason,
      }) + '\n')
    } catch { /* 忽略 */ }
  }

  async function tick() {
    if (stopped) return
    try {
      const now = Date.now()
      if (!scheduler.inWindow(now)) {
        scheduleNext(now)
        return
      }
      const seen = new Set()
      const report = []
      for (const agent of host.listAgents?.() ?? []) {
        if (stopped) return
        const sid = agent?.session?.id ?? agent?.id
        if (!sid || !binding.manages(sid)) continue
        const creature = binding.resolve({ sessionId: sid, workspace: workspaceOf(agent?.session) })
        if (!creature) continue
        const cid = creature.meta.creatureId
        if (seen.has(cid)) continue
        seen.add(cid)
        try {

        const fcfg = configFor(cfg, creature)
        if (fcfg.wake?.enabled === false) continue
        // 想念不再靠事件攒：longingAt 按「距上次互动多久」算

        const broken = creature.openCommitments(fcfg.growth).filter((c) => c.broken).length
        const longing = (creature.affectNow ? creature.affectNow() : creature.fold().affect).longing
        const { reason } = wakeReason({ openBroken: broken, longing })
        const gate = gateFor(creature, fcfg, now)
        const contactDecision = gate.can(now, reason !== null)

        // 自处闸：独立配额；没开就不看
        const selfEnabled = selfTimeEnabled(fcfg, creature)
        const selfGate = selfEnabled ? selfGateFor(creature, fcfg, now) : null
        const selfDecision = selfGate ? selfGate.can(now, true) : { ok: false, reason: 'disabled' }
        const browseToday = countToday(creature, browseDayKey(now, cfg.timezone))

        report.push({
          creature: creature.meta.name,
          reason: reason ?? null,
          longing: Number(longing.toFixed(2)),
          broken,
          gate: contactDecision,
          self: { enabled: selfEnabled, gate: selfDecision, usedToday: browseToday, perDay: fcfg.browse?.perDay ?? 0 },
          at: now,
        })

        let mode = null
        let situation = ''
        if (reason !== null && contactDecision.ok) {
          mode = 'contact'
          situation = wakeSituation(reason)
        } else if (selfEnabled && selfDecision.ok) {
          // 自处不等于上网：她可以只是醒着、写日记、什么都不做。
          // 上网配额在工具入口按「自处回合」收紧，不在这里把整次自处砍掉。
          mode = 'self'
          situation = selfSituation(creature, fcfg)
        }

        if (!mode) continue

        // 自处不能打断对话：等不到空闲就跳过，不消耗配额。
        if (mode === 'self') {
          const idle = await waitIdle(agent, Number(fcfg.selfTime?.idleWaitMs ?? 15000))
          if (!idle) {
            report[report.length - 1].self.gate = { ok: false, reason: 'busy' }
            continue
          }
        }

        // 醒来前看一眼：她最近发过的评论下面有没有人回她。
        // 有就作为素材放进这次处境（不是用户的话）；等真的叫醒成功后再记成「看过了」。
        let situationText = situation
        let pendingReplies = []
        try {
          const r = await scanDueReplies(creature, cfg, { now })
          if (r?.text) {
            situationText += '\n\n' + r.text
            pendingReplies = r.items ?? []
          }
        } catch { /* 扫不到就算了，不影响醒 */ }

        const text = wakeTrigger(now, situationText, mode)
        if (!text) continue

        if (!agent) {
          // 会话没开着：联系型进 outbox；自处型不补投（没有活着的会话就不自处）
          if (mode === 'contact') {
            creature.store.appendOutbox({
              id: randomUUID(), ts: now, text, channel: 'dsm-session', delivered: false,
              wake: { mode: 'contact', reason },
            })
            creature.recordOutreach(reason, now)
            recordWake(creature, 'contact', reason, now)
            gate.consume(now)
          }
          continue
        }

        if (mode === 'contact') {
          gate.consume(now)
          creature.recordOutreach(reason, now)
          recordWake(creature, 'contact', reason, now)
        } else {
          selfGate?.consume(now)
          recordWake(creature, 'self', null, now)
          // 这一轮是自处：工具入口按本轮收紧上网配额（10 分钟内有效）
          markSelfTime(cid, now + 10 * 60_000)
        }
        try {
          await host.wake(agent, injectMessage(text, { mode, reason: mode === 'contact' ? reason : null }))
          traceWake(sid, cid, mode, mode === 'contact' ? reason : null)
          for (const it of pendingReplies) markReplySeen(creature, it.rpid, browseDayKey(now, cfg.timezone))
        } catch { /* 会话状态变化时可能失败，忽略 */ }
        } catch (err) {
          // 一只鱼出错不能拖垮整轮
          report.push({ creature: creature.meta.name, error: String((err && err.message) || err), at: now })
        }
      }
      try { fs.writeFileSync(wakeStatePath(cfg.stateDir), JSON.stringify({ ts: now, entries: report }, null, 2)) } catch { /* 忽略 */ }
    } catch {
      /* 唤醒循环绝不外抛 */
    }
    scheduleNext(Date.now())
  }

  function scheduleNext(now) {
    if (stopped) return
    const nxt = scheduler.nextWake(now, 'active', true)
    const delay = nxt === null ? 60 * 60_000 : Math.max(60_000, nxt - now)
    timer = setTimeout(() => { void tick() }, delay)
  }

  timer = setTimeout(() => { void tick() }, Math.max(20, Number(cfg.wake.firstDelayMs) || 10_000))
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}
