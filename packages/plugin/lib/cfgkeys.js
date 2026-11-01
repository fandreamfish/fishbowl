/**
 * 配置键的校验：只接受认识的键，防前端塞垃圾。
 * 纯函数、零依赖；设置页（ui-route）与每条鱼的配置文件（fishcfg）共用一份。
 */

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * 只接受认识的作息配置键（防前端塞垃圾）。
 * wake：清醒节律；contact：主动联系配额。纯函数，可测。
 */
export function pickRoutineConfig(x) {
  const out = {}
  const w = x?.wake
  if (w && typeof w === 'object') {
    const wake = {}
    if (typeof w.enabled === 'boolean') wake.enabled = w.enabled
    if (Number.isFinite(Number(w.absenceHours))) wake.absenceHours = Math.min(72, Math.max(1, Number(w.absenceHours)))
    if (Array.isArray(w.activeWindow) && w.activeWindow.length === 2 && w.activeWindow.every((t) => HHMM.test(String(t)))) {
      wake.activeWindow = [String(w.activeWindow[0]), String(w.activeWindow[1])]
    }
    if (w.interval && typeof w.interval === 'object') {
      const mode = w.interval.mode === 'random' ? 'random' : 'fixed'
      const iv = { mode }
      if (typeof w.interval.min === 'string' && w.interval.min.trim()) iv.min = w.interval.min.trim()
      if (mode === 'random' && typeof w.interval.max === 'string' && w.interval.max.trim()) iv.max = w.interval.max.trim()
      wake.interval = iv
    }
    if (typeof w.idleSkip === 'boolean') wake.idleSkip = w.idleSkip
    if (Object.keys(wake).length) out.wake = wake
  }
  const c = x?.contact
  if (c && typeof c === 'object') {
    const contact = {}
    if (Array.isArray(c.window) && c.window.length === 2 && c.window.every((t) => HHMM.test(String(t)))) {
      contact.window = [String(c.window[0]), String(c.window[1])]
    }
    if (Number.isFinite(Number(c.dailyMax))) contact.dailyMax = Math.min(10, Math.max(0, Math.round(Number(c.dailyMax))))
    if (typeof c.minGap === 'string' && c.minGap.trim()) contact.minGap = c.minGap.trim()
    if (Number.isFinite(Number(c.unansweredStop))) contact.unansweredStop = Math.min(10, Math.max(1, Math.round(Number(c.unansweredStop))))
    if (typeof c.requireReason === 'boolean') contact.requireReason = c.requireReason
    if (Object.keys(contact).length) out.contact = contact
  }
  const s = x?.selfTime
  if (s && typeof s === 'object') {
    const self = {}
    if (typeof s.enabled === 'boolean') self.enabled = s.enabled
    if (Array.isArray(s.window) && s.window.length === 2 && s.window.every((t) => HHMM.test(String(t)))) {
      self.window = [String(s.window[0]), String(s.window[1])]
    }
    if (Number.isFinite(Number(s.dailyMax))) self.dailyMax = Math.min(6, Math.max(0, Math.round(Number(s.dailyMax))))
    if (typeof s.minGap === 'string' && /^\d+(?:\.\d+)?\s*[smhd]$/.test(s.minGap.trim())) self.minGap = s.minGap.trim()
    if (Object.keys(self).length) out.selfTime = self
  }
  return out
}

/** 只接受认识的「在 B 站说话」配置键（防前端塞垃圾）。 */
export function pickCommentConfig(x) {
  if (!x || typeof x !== 'object') return undefined
  const out = {}
  if (typeof x.enabled === 'boolean') out.enabled = x.enabled
  if (Number.isFinite(Number(x.perDay))) out.perDay = Math.min(5, Math.max(0, Math.round(Number(x.perDay))))
  if (Number.isFinite(Number(x.replyPerDay))) out.replyPerDay = Math.min(10, Math.max(0, Math.round(Number(x.replyPerDay))))
  if (typeof x.replyToReplies === 'boolean') out.replyToReplies = x.replyToReplies
  if (Number.isFinite(Number(x.scanEveryMin))) out.scanEveryMin = Math.min(720, Math.max(5, Math.round(Number(x.scanEveryMin))))
  if (typeof x.atOwner === 'boolean') out.atOwner = x.atOwner
  if (Array.isArray(x.window) && x.window.length === 2 && x.window.every((t) => HHMM.test(String(t)))) {
    out.window = [String(x.window[0]), String(x.window[1])]
  }
  return out
}

/** 只接受认识的记忆配置键（防前端塞垃圾）。 */
export function pickMemoryConfig(x) {
  const out = {}
  for (const k of ['turnsPerRecord', 'consolidateCap', 'recallPool', 'injectBudget', 'memoryRatio', 'turnRatio']) {
    if (typeof x?.[k] === 'number' && Number.isFinite(x[k])) out[k] = x[k]
  }
  if (typeof x?.herSummaryOnPlainTurns === 'boolean') out.herSummaryOnPlainTurns = x.herSummaryOnPlainTurns
  if (typeof x?.neutralModel === 'string') out.neutralModel = x.neutralModel
  if (typeof x?.searchTool === 'boolean') out.searchTool = x.searchTool
  if (x?.singleWriter === 'off' || x?.singleWriter === 'warn' || x?.singleWriter === 'strict') out.singleWriter = x.singleWriter
  if (x?.embeddings && typeof x.embeddings === 'object') {
    out.embeddings = {
      enabled: x.embeddings.enabled === true,
      model: typeof x.embeddings.model === 'string' ? x.embeddings.model : '',
      baseUrl: typeof x.embeddings.baseUrl === 'string' ? x.embeddings.baseUrl : '',
    }
  }
  if (Array.isArray(x?.tags)) out.tags = x.tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim()).slice(0, 40)
  return out
}

/**
 * 记忆配置的语义校验（纯函数）。
 * 结构上合法的值不一定说得通：上限小于记录间隔、召回池装不下注入条数、标签表被清空。
 * 规则本体在 packages/memory/src/config.ts，这里只做转出（设置页与引擎共用一份）。
 */