/** 节律与配额的配置校验：纯函数，不依赖宿主。 */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const DUR = /^\d+(?:\.\d+)?\s*[smhd]$/

export function normalizeWake(raw) {
  const w = raw || {}
  return {
    enabled: w.enabled === true,
    firstDelayMs: Number.isFinite(Number(w.firstDelayMs)) ? Number(w.firstDelayMs) : 10000,
    absenceHours: Number(w.absenceHours) > 0 ? Number(w.absenceHours) : 8,
    activeWindow: w.activeWindow ?? ['08:00', '23:30'],
    interval: w.interval ?? { mode: 'fixed', min: '60m' },
    dwell: w.dwell ?? ['1m', '3m'],
    idleSkip: w.idleSkip ?? true,
    stateMultiplier: w.stateMultiplier ?? { active: 1, fading: 4, dormant: 24 },
  }
}

export function normalizeContact(raw) {
  const c = raw || {}
  return {
    window: c.window ?? ['09:00', '22:30'],
    dailyMax: c.dailyMax ?? 2,
    minGap: c.minGap ?? '3h',
    burst: c.burst ?? { max: 1, per: '2h' },
    requireReason: c.requireReason ?? true,
    unansweredStop: c.unansweredStop ?? 3,
  }
}

export function normalizeSelfTime(raw) {
  const s = raw || {}
  return {
    enabled: s.enabled === true,
    window: (() => {
      const w = s.window
      return Array.isArray(w) && w.length === 2 && w.every((x) => HHMM.test(String(x)))
        ? [String(w[0]), String(w[1])]
        : ['09:00', '23:00']
    })(),
    dailyMax: Number.isFinite(Number(s.dailyMax)) ? Math.max(0, Math.min(6, Math.round(Number(s.dailyMax)))) : 1,
    minGap: DUR.test(String(s.minGap ?? '')) ? String(s.minGap) : '90m',
    idleWaitMs: Number.isFinite(Number(s.idleWaitMs)) ? Math.max(0, Math.min(120000, Number(s.idleWaitMs))) : 15000,
  }
}

/** 只接受认识的作息配置键（防前端塞垃圾）。 */
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
    if (typeof s.minGap === 'string' && DUR.test(s.minGap.trim())) self.minGap = s.minGap.trim()
    if (Object.keys(self).length) out.selfTime = self
  }
  return out
}
