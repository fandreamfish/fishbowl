/** Small pure helpers. */

export function clip(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x))
}

const DUR_RE = /^\s*(\d+(?:\.\d+)?)\s*([smhd])\s*$/
const DUR_MULT: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }

/** '30m' -> 1800 seconds */
export function parseDur(text: string): number {
  const m = DUR_RE.exec(String(text))
  if (!m) throw new Error(`bad duration: ${JSON.stringify(text)}`)
  return parseFloat(m[1]) * DUR_MULT[m[2]]
}

/** '08:30' -> 510 minutes since midnight */
export function parseHm(text: string): number {
  const [h, m] = text.split(':').map(Number)
  return h * 60 + m
}

/**
 * 某个时刻在指定时区的"几点几分"，换算成当天分钟数。
 * 时区必须显式传入——不用系统时区，否则搬到 UTC 服务器后作息全乱。
 */
export function wallClockMinutes(epochMs: number, timezone: string): number {
  return Math.floor(wallClockSeconds(epochMs, timezone) / 60)
}

/** 某个时刻在指定时区的"当天秒数"。 */
export function wallClockSeconds(epochMs: number, timezone: string): number {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23', timeZone: timezone,
  })
  const [h, m, s] = fmt.format(new Date(epochMs)).split(':').map(Number)
  return (h * 60 + m) * 60 + s
}

/** 确定性 PRNG（mulberry32），测试与可复现采样用。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function uid(): string {
  return globalThis.crypto.randomUUID()
}
