/**
 * M3.0：清醒节律与主动联系。
 * 纯决策函数（可测）+ 宿主侧定时器（在插件上下文里跑）。
 * 默认关闭（cfg.wake.enabled），先观察、后打开。
 */
import { ContactGate } from '../../../src/core/contact.ts'
import { Scheduler } from '../../../src/core/scheduler.ts'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createDshHost } from '../host/dsh.js'
import { injectMessage } from './injector.js'
import { callLLM } from './llm.js'
import { voiceRulesFor } from './voice.js'

/**
 * 唤醒决策：醒了之后有没有话要说。
 * 由头必须来自她自己的事：先还债（未完成的承诺），再想念（缺席累积）。
 */
export function wakeReason(state) {
  if (state.openBroken > 0) return { reason: `有 ${state.openBroken} 件答应过的事还没做完` }
  if (state.longing > 0.4) return { reason: '很久没好好说话了' }
  return { reason: null }
}

/** 主动开口的生成提示。 */
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

/**
 * 启动唤醒循环。返回 cleanup。
 * @param {import('./types.js').FishbowlConfig} cfg
 */
/** 唤醒状态文件：给设置页看「她现在为什么没开口」。 */
export function wakeStatePath(stateDir) {
  return path.join(stateDir, 'wake-state.json')
}

/** 用她的声音写一句开场白（循环和"现在叫一次"共用）。 */
export async function generateProactive(cfg, creature, reason) {
  const mem = creature.memorySummary(cfg.growth)
  const stateLine = `名字：${mem.name ?? '（还没名字）'}；未完成的承诺：${mem.commitments.join('；') || '无'}`
  const text = await callLLM(cfg, voiceRulesFor(cfg.relation?.kind), proactivePrompt(reason, stateLine), { json: false, maxTokens: 80 })
  return String(text ?? '').trim().slice(0, 200)
}
export function createWakeLoop(ctx, binding, cfg, host) {
  host = host ?? createDshHost(ctx, cfg)
  if (!cfg.wake?.enabled) return () => {}

  const scheduler = new Scheduler(cfg.wake, cfg.timezone)
  const gate = new ContactGate(cfg.contact, cfg.timezone)
  let timer = null
  let stopped = false

  /** 记一笔"她主动开口了"，方便排查。 */
  function traceWake(sessionId, creatureId, reason) {
    try {
      fs.appendFileSync(path.join(cfg.stateDir, 'trace.ndjson'), JSON.stringify({
        ts: Date.now(), sessionId, creatureId, event: 'wake', reason,
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
      // 按活着的 agent 走：一只鱼可能被多个会话共享（住整个工作区），同一次只处理一遍
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

        // 长时间没说话 → 记一条缺席（longing 就是这么来的）
        const events = creature.store.readEvents()
        if (shouldRecordAbsence(events, now, cfg.wake.absenceHours ?? 8)) {
          const hours = absenceHours(events, now)
          if (hours !== null) creature.recordAbsence(hours)
        }

        const broken = creature.openCommitments(cfg.growth).filter(c => c.broken).length
        const longing = creature.fold().affect.longing
        const { reason } = wakeReason({ openBroken: broken, longing })
        const decision = gate.can(now, reason !== null)
        report.push({ creature: creature.meta.name, reason: reason ?? null, longing: Number(longing.toFixed(2)), broken, gate: decision, at: now })
        if (!decision.ok || reason === null) continue

        const text = await generateProactive(cfg, creature, reason)
        if (!text) continue
        if (!agent) {
          // 会话没开着——进投递队列，下次会话打开时补投
          creature.store.appendOutbox({ id: randomUUID(), ts: now, text, channel: 'dsm-session', delivered: false })
          gate.consume(now)
          continue
        }
        gate.consume(now)
        try {
          await host.wake(agent, injectMessage(text))
          traceWake(sid, cid, reason)
        } catch { /* 会话状态变化时可能失败，忽略 */ }
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

  timer = setTimeout(() => { void tick() }, 10_000)
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}
