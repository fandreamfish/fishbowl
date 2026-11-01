/**
 * 上网的运行时：把客户端、风控、配置、记账串起来。
 * 不碰宿主；tool / 设置页 / 自处唤醒都从这里调用。
 */
import { browseDayKey, browsePlan, inWindow } from './browse.ts'
import { createClient, inCooldown, setPacing } from './client.js'
import { lookOnce, recordBrowse } from './browse.js'
import { riskState, noteRisk, markRiskOk } from './risk.js'
import { browseSummary, countToday } from './store.js'
import { browseGrant } from '../../being/src/grant.js'

/**
 * 「当前这一轮是自处醒来的」。
 * 只在自处回合里收紧上网配额；用户让她现在看不受这个限制。
 */
const SELF_UNTIL = new Map()

export function markSelfTime(creatureId, until) {
  if (creatureId) SELF_UNTIL.set(String(creatureId), Number(until) || 0)
}

export function inSelfTime(creatureId, now = Date.now()) {
  return Number(SELF_UNTIL.get(String(creatureId ?? '')) ?? 0) > now
}

function noteOf(r, fallback = '') {
  return String(r?.note ?? r?.message ?? fallback ?? '').slice(0, 200)
}

/**
 * 让她看一次。工具、设置页的「现在去刷一次」、自处回合共用。
 *
 * 硬约束：
 *   - 开关关着：明确说打不开，不发请求；
 *   - 风控冷却中：不碰 B 站；
 *   - 失败不抛；成功才记账（配额只算真的有素材的）。
 */
export async function lookForCreature(creature, cfg, opts = {}) {
  if (!creature) return { ok: false, text: '', picks: [], note: '这条会话里没有鱼住。' }
  if (!cfg?.browse?.enabled) return { ok: false, text: '', picks: [], note: '现在打不开。' }

  const now = Number(opts.now) || Date.now()
  if (!opts.force && !inWindow(now, cfg.browse.window, cfg.timezone)) {
    return { ok: false, text: '', picks: [], note: '这个点不看了。' }
  }
  const risk = riskState(cfg.stateDir, now)
  if (risk.cooling) {
    return { ok: false, text: '', picks: [], note: risk.remainMin > 0 ? `B 站这会儿不让我看，还要等 ${risk.remainMin} 分钟左右。` : 'B 站这会儿不让我看。' }
  }
  const plan = browsePlan(cfg.browse, risk)
  if (plan.skip) return { ok: false, text: '', picks: [], note: plan.note || '这会儿不看了。' }

  // 自处回合里按「每天几次」收紧；用户点名要看时不受这个限制。
  if (opts.selfTime) {
    const day = browseDayKey(now, cfg.timezone)
    if (countToday(creature, day) >= Number(cfg.browse.perDay ?? 0)) {
      return { ok: false, text: '', picks: [], note: '这会儿不看了。' }
    }
  }

  setPacing(cfg.browse.pacing)
  const client = opts.client ?? createClient({
    minIntervalMs: cfg.browse.pacing?.minIntervalMs,
    jitterMs: cfg.browse.pacing?.jitterMs,
    log: typeof opts.log === 'function' ? opts.log : undefined,
    onRisk: (code) => noteRisk(cfg.stateDir, code, now),
  })

  // 刚被风控过：这次少看几条、少深读几条，先试探。
  const cfg2 = (plan.topN !== cfg.browse.topN || plan.deepRead !== cfg.browse.deepRead)
    ? { ...cfg, browse: { ...cfg.browse, topN: plan.topN, deepRead: plan.deepRead } }
    : cfg

  const result = await lookOnce({
    client,
    cfg: cfg2,
    creature,
    what: opts.what ?? 'home',
    keyword: opts.keyword,
    bvid: opts.bvid,
    mode: opts.mode ?? 'tool',
  })
  if (result.ok) markRiskOk(cfg.stateDir, now)

  const day = browseDayKey(now, cfg.timezone)
  recordBrowse(creature, result, {
    now,
    day,
    mode: opts.mode ?? 'tool',
    what: opts.what ?? 'home',
  })

  // 客户端内存里的 60 秒冷却也算「现在别试了」，给个可读原因
  if (!result.ok && inCooldown(now) && !result.note) {
    return { ...result, note: 'B 站这会儿不让我看了，过一会儿再说。' }
  }
  return { ...result, note: noteOf(result) }
}

/** 今天/历史/风控/许可，给设置页。 */
export function browseStatus(creature, cfg, now = Date.now()) {
  const day = browseDayKey(now, cfg.timezone)
  const risk = riskState(cfg.stateDir, now)
  const grant = browseGrant(creature)
  return {
    ...browseSummary(creature, cfg.browse, day, now),
    day,
    enabled: !!cfg.browse.enabled,
    window: cfg.browse.window,
    risk,
    granted: !!grant,
    grantText: grant?.text ?? '',
    canBrowse: !!cfg.browse.enabled && !risk.cooling,
  }
}
