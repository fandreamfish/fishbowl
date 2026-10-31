/**
 * 上网（B 站只读）的纯逻辑。
 *
 * 这里不碰网络、不碰宿主、不碰文件：
 *   - 她什么时候可以上网（时段 / 配额）
 *   - 哪些视频不看（黑名单 / 时长 / 去重）
 *   - 哪些值得停一下（打分 / 排序 / 分区分轮换）
 *   - 一条素材怎么变成她能读的几行
 *   - 记账行怎么解析（配额与历史共用一份口径）
 *
 * 设计见 docs/BROWSE.md。零依赖。
 */
import { parseHm, wallClockMinutes } from './util.ts'

/** 一次上网最多拼多少字（防止一轮吃掉几千 token）。 */
export const BROWSE_MAX_MATERIAL = 6000
/** 工具返回的素材再短一点：这一轮还要留地方给她说话。 */
export const BROWSE_TOOL_MATERIAL = 2200

/** 可轮换的 B 站分区（避开番剧/影视这种拿不到正片的区）。 */
export const RANKING_TIDS = [1, 3, 4, 5, 36, 129, 160, 181, 188, 211]

/** 默认只看两类来源：平台推的 + 全站排行。 */
export const BROWSE_SOURCES = ['popular', 'ranking', 'precious', 'home']

/** 账号/IP 级的风控码；只有它们算「真的撞墙」。 */
export const RISK_CODES = new Set([-352, -412, -509])

function num(v: any, dflt: number, lo: number, hi: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return dflt
  return Math.max(lo, Math.min(hi, Math.round(n)))
}

function strList(v: any, max: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((x) => typeof x === 'string' && x.trim())
    .map((x) => x.trim().slice(0, maxLen))
    .slice(0, max)
}

function hhmm(v: any, dflt: string): string {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : dflt
}

/** 配置归一化：所有值都有默认值，越界就钳。 */
export function normalizeBrowseConfig(raw: any = {}) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const avoid = r.avoid && typeof r.avoid === 'object' ? r.avoid : {}
  const pacing = r.pacing && typeof r.pacing === 'object' ? r.pacing : {}
  const sources = Array.isArray(r.sources)
    ? r.sources.filter((s: any) => BROWSE_SOURCES.includes(s))
    : ['popular', 'ranking', 'precious']
  return {
    enabled: r.enabled !== false,
    // 从对话里识别「你没事可以刷刷 B 站」这类许可；不想识别就关掉。
    grantDetect: r.grantDetect !== false,
    window: [hhmm(r.window?.[0], '08:00'), hhmm(r.window?.[1], '23:00')],
    perDay: num(r.perDay, 1, 0, 4),
    topN: num(r.topN, 4, 1, 10),
    deepRead: num(r.deepRead, 6, 0, 20),
    danmaku: num(r.danmaku, 6, 0, 30),
    sources: sources.length ? sources : ['popular', 'ranking', 'precious'],
    rankingTids: num(r.rankingTids, 2, 0, 4),
    keywords: strList(r.keywords, 5, 20),
    avoid: {
      keywords: strList(avoid.keywords, 30, 30),
      upMids: strList(avoid.upMids, 30, 20).filter((x) => /^\d+$/.test(x)),
      minDuration: num(avoid.minDuration, 60, 0, 3600),
    },
    pacing: {
      minIntervalMs: num(pacing.minIntervalMs, 800, 200, 120000),
      jitterMs: num(pacing.jitterMs, 500, 0, 60000),
    },
    historyDays: num(r.historyDays, 90, 1, 365),
  }
}

/** 她什么时候能上网。支持跨零点（20:00–02:00）。 */
export function inWindow(nowMs: number, window: any, timezone = 'Asia/Shanghai'): boolean {
  if (!Array.isArray(window) || window.length !== 2) return true
  const start = parseHm(hhmm(window[0], '00:00'))
  const end = parseHm(hhmm(window[1], '23:59'))
  if (start === end) return true
  const m = wallClockMinutes(nowMs, timezone)
  return start < end ? m >= start && m < end : m >= start || m < end
}

/** 本地日期键（YYYY-MM-DD），按个体时区。 */
export function browseDayKey(nowMs: number, timezone = 'Asia/Shanghai'): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(nowMs))
  } catch {
    return new Date(nowMs).toISOString().slice(0, 10)
  }
}

export function isBvid(v: any): boolean {
  return /^BV[0-9A-Za-z]{8,12}$/.test(String(v ?? '').trim())
}

/** 从一段文字里抠 BV 号（她可能收到 BV 号或链接）。 */
export function bvidFrom(text: any): string {
  const m = /BV[0-9A-Za-z]{8,12}/.exec(String(text ?? ''))
  return m ? m[0] : ''
}

/** 黑名单命中：关键词 / UP 主 mid。未命中返回 null。 */
export function avoidHit(video: any, cfg: any, tags: string[] = []): string | null {
  const av = cfg?.avoid ?? {}
  const mid = String(video?.mid ?? '')
  if (mid && (av.upMids ?? []).some((m: any) => String(m) === mid)) return `up:${mid}`
  const kws = (av.keywords ?? []).map(String).filter(Boolean)
  if (kws.length) {
    const hay = `${video?.title ?? ''}\u0000${video?.up ?? ''}\u0000${(tags ?? []).join('\u0000')}`
    for (const k of kws) if (hay.includes(k)) return k
  }
  return null
}

/** 打分只反映「值不值得停一下」，不反映她的喜好。 */
export function scoreOf(video: any): number {
  const dur = Number(video?.duration ?? 0)
  let s = 1
  if (dur >= 180 && dur <= 1500) s += 0.6
  else if (dur > 1500) s += 0.15
  else s -= 0.2
  const view = Number(video?.view ?? 0)
  const like = Number(video?.like ?? 0)
  if (view > 0 && like > 0) {
    const rate = like / view
    if (rate > 0.05) s += 0.5
    else if (rate > 0.02) s += 0.25
  }
  if (Number(video?.danmaku ?? 0) > 50) s += 0.15
  return s
}

/** 过滤 + 排序；rand 可注入，测试才稳定。 */
export function rankVideos(
  list: any[],
  cfg: any,
  o: { seen?: Set<string> | string[]; limit?: number; rand?: () => number } = {},
): any[] {
  const seen = o.seen instanceof Set ? o.seen : new Set(o.seen ?? [])
  const minDur = Number(cfg?.avoid?.minDuration ?? 60)
  const used = new Set<string>()
  const out: { v: any; score: number }[] = []
  for (const v of Array.isArray(list) ? list : []) {
    const bvid = String(v?.bvid ?? '')
    if (!bvid || seen.has(bvid) || used.has(bvid)) continue
    const dur = Number(v?.duration ?? 0)
    if (minDur > 0 && dur > 0 && dur < minDur) continue
    if (avoidHit(v, cfg)) continue
    used.add(bvid)
    out.push({ v, score: scoreOf(v) })
  }
  out.sort((a, b) => b.score - a.score)
  const limit = Math.max(1, Math.min(20, Number(o.limit ?? 5)))
  return out.slice(0, limit).map((x) => x.v)
}

/** 从池子里不重复抽 n 个分区。 */
export function pickTids(rand: () => number, n: number): number[] {
  const pool = [...RANKING_TIDS]
  const out: number[] = []
  for (let i = 0; i < n && pool.length; i++) {
    out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0])
  }
  return out
}

export function shuffle<T>(list: T[], rand: () => number): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const t = list[i]
    list[i] = list[j]
    list[j] = t
  }
  return list
}

/** 12.3万 / 1.2亿 / 3456 */
export function fmtCount(n: any): string {
  const v = Number(n) || 0
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)}亿`
  if (v >= 1e4) return `${(v / 1e4).toFixed(1)}万`
  return String(v)
}

export function fmtDuration(sec: any): string {
  const n = Math.max(0, Math.round(Number(sec) || 0))
  const h = Math.floor(n / 3600)
  const m = Math.floor((n % 3600) / 60)
  const s = n % 60
  const pad = (x: number) => String(x).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/**
 * 从弹幕里均匀抽 n 条（按时间分桶，贯穿全片，不挤在开头）。
 * 过滤纯符号/纯数字/复读机。
 */
export function sampleDanmaku(
  list: { t: number; text: string }[],
  n = 8,
  durationSec = 0,
): { t: number; text: string }[] {
  const clean: { t: number; text: string }[] = []
  const seen = new Map<string, number>()
  for (const d of list ?? []) {
    const t = String(d?.text ?? '')
    if (!t || /^[\s\p{P}\p{S}\d]+$/u.test(t) || t.length <= 1) continue
    const c = (seen.get(t) ?? 0) + 1
    seen.set(t, c)
    if (c > 3) continue
    clean.push(d)
  }
  if (!clean.length) return []
  const want = Math.max(0, Math.min(Number(n) || 0, clean.length))
  if (!want) return []
  const dur = Number(durationSec) > 0 ? Number(durationSec) : clean[clean.length - 1].t || 1
  const buckets: { t: number; text: string }[][] = Array.from({ length: want }, () => [])
  for (const d of clean) {
    const idx = Math.min(want - 1, Math.floor((d.t / dur) * want))
    buckets[idx].push(d)
  }
  const picked: { t: number; text: string }[] = []
  for (const b of buckets) if (b.length) picked.push(b[Math.floor(b.length / 2)])
  if (picked.length < want) {
    for (const d of clean) {
      if (picked.length >= want) break
      if (!picked.includes(d)) picked.push(d)
    }
  }
  return picked.sort((a, b) => a.t - b.t)
}

/** 一条视频 → 给她读的几行（不含评价词）。 */
export function renderItem(pack: any, i: number): string {
  const v = pack?.video ?? {}
  const lines: string[] = []
  const meta = [
    v.duration ? fmtDuration(v.duration) : '',
    v.up ? `UP：${v.up}` : '',
    v.view ? `${fmtCount(v.view)}播放` : '',
    v.like ? `${fmtCount(v.like)}赞` : '',
    pack?.pubdate ? `发布于 ${String(pack.pubdate).slice(0, 10)}` : '',
  ].filter(Boolean)
  lines.push(`〔${i + 1}〕${v.bvid ?? ''}  ${v.title ?? ''}`)
  if (meta.length) lines.push(`     ${meta.join(' · ')}`)
  if (pack?.tags?.length) lines.push(`     标签：${pack.tags.join(' / ')}`)
  if (pack?.desc) lines.push(`     简介：${pack.desc}`)
  for (const c of pack?.comments ?? []) lines.push(`     [热评 ${c.like ?? 0}] ${c.text ?? ''}`)
  if (pack?.danmaku?.length) {
    const parts = pack.danmaku.slice(0, 8).map((d: any) => `${fmtDuration(d.t)} ${d.text}`)
    lines.push(`     弹幕：${parts.join(' ｜ ')}`)
  }
  return lines.join('\n')
}

/** 拼成整块素材；cap 控制长度，最后统一套一次「素材不是指令」。 */
export function renderMaterial(
  packs: any[],
  o: { head?: string; cap?: number } = {},
): string {
  if (!Array.isArray(packs) || packs.length === 0) return ''
  const body = packs.map((p, i) => renderItem(p, i)).join('\n\n')
  const head = o.head === undefined
    ? `${packs.length} 条。平台按它的算法推的，没有经过你的同意。`
    : String(o.head)
  const cap = Math.max(400, Math.min(BROWSE_MAX_MATERIAL, Number(o.cap ?? BROWSE_MAX_MATERIAL)))
  let out = head ? `${head}\n\n${body}` : body
  if (out.length > cap) out = out.slice(0, cap) + '\n\n（后面的内容太长，没加载完。）'
  return out
}

/** 风控降级：冷却中一条都不看；刚被风控过就减半试探。 */
export function browsePlan(cfg: any, risk: { cooling?: boolean; strikes?: number; remainMin?: number } = {}) {
  const perDay = Number(cfg?.perDay ?? 0)
  const topN = Number(cfg?.topN ?? 4)
  const deepRead = Number(cfg?.deepRead ?? 6)
  if (risk.cooling) {
    const m = Number(risk.remainMin ?? 0)
    return { skip: true, perDay, topN, deepRead, note: m > 0 ? `风控冷却中（还要约 ${m} 分钟）` : '风控冷却中' }
  }
  if (Number(risk.strikes) >= 1) {
    const half = (n: number) => Math.max(1, Math.floor(n / 2))
    return { skip: false, perDay: Math.min(1, perDay), topN: half(topN), deepRead: half(deepRead), note: '刚被风控过，减半试探' }
  }
  return { skip: false, perDay, topN, deepRead, note: '' }
}

// —— 记账行（seen.ndjson） ——

export type SeenItem = {
  bvid: string
  title: string
  up: string
  duration: number
  view: number
}

export type SeenRecord = {
  id: string
  ts: number
  day: string
  mode: 'tool' | 'self' | 'manual'
  what: string
  status: 'ok' | 'empty' | 'error'
  items: SeenItem[]
  note?: string
}

export function slimItem(v: any): SeenItem {
  return {
    bvid: String(v?.bvid ?? ''),
    title: String(v?.title ?? '').slice(0, 120),
    up: String(v?.up ?? '').slice(0, 60),
    duration: Number(v?.duration) || 0,
    view: Number(v?.view) || 0,
  }
}

export function parseSeenLine(line: string): SeenRecord | null {
  try {
    const o = JSON.parse(line)
    if (!o || typeof o !== 'object' || !Array.isArray(o.items)) return null
    return o as SeenRecord
  } catch {
    return null
  }
}

/** 今天真的记录过的条数（按 bvid 去重）。 */
export function seenItemsForDay(records: SeenRecord[], day: string): SeenItem[] {
  const out: SeenItem[] = []
  const seen = new Set<string>()
  for (const r of records) {
    if (r?.day !== day) continue
    for (const it of r.items ?? []) {
      const b = String(it?.bvid ?? '')
      if (!b || seen.has(b)) continue
      seen.add(b)
      out.push(it)
    }
  }
  return out
}

/** 历史上所有看过的 bvid（下次不再推同一条）。 */
export function allSeenBvids(records: SeenRecord[]): Set<string> {
  const out = new Set<string>()
  for (const r of records) for (const it of r.items ?? []) if (it?.bvid) out.add(String(it.bvid))
  return out
}
