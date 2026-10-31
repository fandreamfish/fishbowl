/** 主动联系：分层限流。所有限制取交集，最严的一条生效。 */
import { parseDur, parseHm, wallClockMinutes } from './util.ts'

export interface ContactConfig {
  window: [string, string]
  dailyMax: number
  minGap: string
  burst: { max: number; per: string }
  requireReason?: boolean
  unansweredStop?: number
}

export class ContactGate {
  readonly cfg: ContactConfig
  readonly timezone: string
  history: number[] = []
  unanswered = 0

  constructor(cfg: ContactConfig, timezone: string) {
    this.cfg = cfg
    this.timezone = timezone
  }

  inWindow(epochMs: number): boolean {
    const m = wallClockMinutes(epochMs, this.timezone)
    return parseHm(this.cfg.window[0]) <= m && m < parseHm(this.cfg.window[1])
  }

  /** 从账本恢复历史（跨重启的配额）。 */
  hydrate(times: number[]): void {
    this.history = [...times].sort((a, b) => a - b)
  }

  can(nowMs: number, hasReason: boolean): { ok: boolean; reason: string } {
    if (!this.inWindow(nowMs)) return { ok: false, reason: 'quiet_hours' }
    if (this.cfg.requireReason !== false && !hasReason) return { ok: false, reason: 'no_reason' }
    if (this.unanswered >= (this.cfg.unansweredStop ?? 3)) return { ok: false, reason: 'unanswered_stop' }

    // rolling_24h：滚动窗口，不是自然日（避免午夜前连发两条）
    const day = this.history.filter(t => nowMs - t < 86_400_000)
    if (day.length >= this.cfg.dailyMax) return { ok: false, reason: 'daily_max' }

    if (this.history.length > 0
      && nowMs - this.history[this.history.length - 1] < parseDur(this.cfg.minGap) * 1000) {
      return { ok: false, reason: 'min_gap' }
    }

    const burst = this.history.filter(t => nowMs - t < parseDur(this.cfg.burst.per) * 1000)
    if (burst.length >= this.cfg.burst.max) return { ok: false, reason: 'burst' }

    return { ok: true, reason: 'ok' }
  }

  consume(nowMs: number): void {
    this.history.push(nowMs)
  }

  onReply(): void {
    this.unanswered = 0
  }

  onNoReply(): void {
    this.unanswered += 1
  }
}
