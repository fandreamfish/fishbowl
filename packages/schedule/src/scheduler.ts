/** 清醒节律：什么时候醒。时区显式传入，窗口外是睡眠。 */
import { mulberry32, parseDur, parseHm, wallClockMinutes, wallClockSeconds } from '../../affect/src/util.ts'

export interface WakeConfig {
  activeWindow: [string, string]
  interval: { mode: 'fixed' | 'random'; min: string; max?: string }
  dwell: [string, string]
  idleSkip?: boolean
  stateMultiplier?: Record<string, number>
}

export class Scheduler {
  readonly cfg: WakeConfig
  readonly timezone: string
  readonly rng: () => number

  constructor(cfg: WakeConfig, timezone: string, seed?: number) {
    this.cfg = cfg
    this.timezone = timezone
    this.rng = seed === undefined ? Math.random : mulberry32(seed)
  }

  inWindow(epochMs: number): boolean {
    const m = wallClockMinutes(epochMs, this.timezone)
    return parseHm(this.cfg.activeWindow[0]) <= m && m < parseHm(this.cfg.activeWindow[1])
  }

  /**
   * 把时间戳推进窗口内，再加 0–10 分钟抖动。
   * 抖动以窗口结束为上限——否则 23:20 的一次清醒会被抖到窗口外。
   */
  align(epochMs: number): number {
    let t = epochMs
    for (let i = 0; i < 200 && !this.inWindow(t); i++) t += 30 * 60_000
    if (!this.inWindow(t)) return t

    const endSec = parseHm(this.cfg.activeWindow[1]) * 60
    const untilEnd = (endSec - wallClockSeconds(t, this.timezone)) * 1000
    const jitterLimit = Math.min(600_000, Math.max(untilEnd - 60_000, 0))
    return t + this.rng() * jitterLimit
  }

  intervalSeconds(): number {
    const lo = parseDur(this.cfg.interval.min)
    const hi = parseDur(this.cfg.interval.max ?? this.cfg.interval.min)
    if (this.cfg.interval.mode === 'fixed') return lo
    return lo + this.rng() * (hi - lo)
  }

  /** 下一次清醒。idleSkip 且无事可做 → null（不计费）。 */
  nextWake(nowMs: number, lifeState = 'active', hasWork = true): number | null {
    if (this.cfg.idleSkip && !hasWork) return null
    const mult = this.cfg.stateMultiplier?.[lifeState] ?? 1
    return this.align(nowMs + this.intervalSeconds() * mult * 1000)
  }

  dwellSeconds(): number {
    const lo = parseDur(this.cfg.dwell[0])
    const hi = parseDur(this.cfg.dwell[1])
    return lo + this.rng() * (hi - lo)
  }

  /** 不补课：错过的清醒不补。 */
  lifeState(hoursSinceContact: number): string {
    if (hoursSinceContact >= 720) return 'dormant'
    if (hoursSinceContact >= 168) return 'fading'
    return 'active'
  }
}
