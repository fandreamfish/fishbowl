/** 心情半衰期配置：只有负面情绪可配；0.1–60 天。 */
export interface AffectConfig { guiltDays: number; longingDays: number; negativeDays: number }

export function normalizeAffect(raw: any): AffectConfig {
  const a = raw || {}
  const days = (v: any, dflt: number) => (Number.isFinite(Number(v)) ? Math.min(60, Math.max(0.1, Number(v))) : dflt)
  return {
    guiltDays: days(a.guiltDays, 3),
    longingDays: days(a.longingDays, 2),
    negativeDays: days(a.negativeDays ?? a.namedDays, 2),
  }
}
