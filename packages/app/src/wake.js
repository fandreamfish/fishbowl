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
import { ContactGate } from '../../schedule/src/contact.ts'
import { Scheduler } from '../../schedule/src/scheduler.ts'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { workspaceOf } from './extract.js'
import { configFor } from './fishcfg.js'
import { injectMessage } from './injector.js'
import { browseDayKey } from '../../bilibili/src/browse.ts'
import { recordWake } from '../../being/src/signals.ts'
import { countToday } from '../../bilibili/src/store.js'
import { markReplySeen, scanDueReplies } from '../../bilibili/src/comment.js'
import { markSelfTime } from '../../bilibili/src/runtime.js'
import { wakeReason, wakeSituation, wakeTrigger, selfSituation, selfTimeEnabled, selfGateFor, waitIdle, wakeStatePath } from './wake/plan.js'
export * from './wake/plan.js'


export function createWakeLoop(ctx, binding, cfg, host) {
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