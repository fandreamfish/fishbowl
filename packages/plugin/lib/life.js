/**
 * M3.0：清醒节律与主动联系。
 * 纯决策函数（可测）+ 宿主侧定时器（在插件上下文里跑）。
 * 默认关闭（cfg.wake.enabled），先观察、后打开。
 */
import { ContactGate } from '../../../src/core/contact.ts'
import { Scheduler } from '../../../src/core/scheduler.ts'
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


/**
 * 启动唤醒循环。返回 cleanup。
 * @param {import('./types.js').FishbowlConfig} cfg
 */
export function createWakeLoop(ctx, binding, cfg, host) {
  host = host ?? createDshHost(ctx, cfg)
  if (!cfg.wake?.enabled) return () => {}

  const scheduler = new Scheduler(cfg.wake, cfg.timezone)
  const gate = new ContactGate(cfg.contact, cfg.timezone)
  let timer = null
  let stopped = false

  async function generateProactive(creature, reason) {
    const mem = creature.memorySummary(cfg.growth)
    const stateLine = `名字：${mem.name ?? '（还没名字）'}；未完成的承诺：${mem.commitments.join('；') || '无'}`
    const text = await callLLM(cfg, voiceRulesFor(cfg.relation?.kind), proactivePrompt(reason, stateLine), { json: false, maxTokens: 80 })
    return String(text ?? '').trim().slice(0, 200)
  }

  async function tick() {
    if (stopped) return
    try {
      const now = Date.now()
      if (!scheduler.inWindow(now)) {
        scheduleNext(now)
        return
      }
      for (const sid of Object.keys(binding.bindings)) {
        if (stopped) return
        if (!binding.manages(sid)) continue
        const creature = binding.creatureFor(sid)
        const broken = creature.openCommitments(cfg.growth).filter(c => c.broken).length
        const longing = creature.fold().affect.longing
        const { reason } = wakeReason({ openBroken: broken, longing })
        const decision = gate.can(now, reason !== null)
        if (!decision.ok || reason === null) continue

        const agent = host.agentFor(sid)
        const text = await generateProactive(creature, reason)
        if (!text) continue
        if (!agent) {
          // M3.1：会话没开着——进投递队列，下次会话打开时补投
          creature.store.appendOutbox({ id: randomUUID(), ts: now, text, channel: 'dsm-session', delivered: false })
          gate.consume(now)
          continue
        }
        gate.consume(now)
        try {
          await host.wake(agent, injectMessage(text))
        } catch { /* 会话状态变化时可能失败，忽略 */ }
      }
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
