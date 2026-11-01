/**
 * B 站只读客户端（零依赖）。
 *
 * 只做三件事：拿 buvid3、拿 wbi 密钥、读公开接口。
 * 不登录、不点赞、不投币、不评论、不下载视频。
 *
 * 设计约束（docs/BROWSE.md §8）：
 *   1. 永不抛出：所有方法返回 { ok, data, code, message }；
 *   2. 串行 + 最小间隔 + 抖动；
 *   3. 风控熔断：只认 -352 / -412 / -509；签名接口的 -412 先刷新 wbi 重试一次；
 *   4. 所有请求可注入 fetch（单测不打真网）。
 */
import { createHash } from 'node:crypto'
import { gunzipSync, inflateRawSync, inflateSync } from 'node:zlib'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const API = 'https://api.bilibili.com'

/** wbi 混淆表（B 站前端常量，不是密钥）。 */
const MIXIN = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
]

const RISK_CODES = new Set([-352, -412, -509])
const RISK_BASE_MS = 60_000
const RISK_MAX_MS = 10 * 60_000

const PACE = { minIntervalMs: 800, jitterMs: 500 }
const RISK = { until: 0, streak: 0 }

function paceNum(v, dflt) {
  if (v === null || v === undefined || v === '') return dflt
  const n = Number(v)
  return Number.isFinite(n) ? n : dflt
}

/** 设置页改完不需要重建客户端：所有客户端读同一份节奏。 */
export function setPacing(o = {}) {
  PACE.minIntervalMs = Math.max(200, Math.min(120_000, paceNum(o.minIntervalMs, 800)))
  PACE.jitterMs = Math.max(0, Math.min(60_000, paceNum(o.jitterMs, 500)))
}

export function getPacing() {
  return { ...PACE }
}

export function resetRisk() {
  RISK.until = 0
  RISK.streak = 0
}

export function inCooldown(now = Date.now()) {
  return now < RISK.until
}

export function cooldownLeft(now = Date.now()) {
  return Math.max(0, RISK.until - now)
}

export function isRiskCode(code) {
  return RISK_CODES.has(Number(code))
}

function noteRisk(now) {
  RISK.streak = Math.min(20, RISK.streak + 1)
  const ms = Math.min(RISK_MAX_MS, RISK_BASE_MS * 2 ** (RISK.streak - 1))
  RISK.until = now + ms
  return ms
}

function noteOk() {
  RISK.streak = 0
  RISK.until = 0
}

/** 从 nav 的 img_url / sub_url 打 wbi 密钥。 */
export function mixinKey(imgKey, subKey) {
  const s = String(imgKey ?? '') + String(subKey ?? '')
  let out = ''
  for (const i of MIXIN) out += s[i] ?? ''
  return out.slice(0, 32)
}

/** 参数签名：按键排序、去特殊字符、md5。 */
export function signQuery(params, mk, wts = Math.floor(Date.now() / 1000)) {
  const all = { ...params, wts }
  const q = Object.keys(all)
    .sort()
    .map((k) => {
      const v = String(all[k] ?? '').replace(/[!'()*]/g, '')
      return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`
    })
    .join('&')
  const w_rid = createHash('md5').update(q + mk).digest('hex')
  return `${q}&w_rid=${w_rid}`
}

export function unescapeHtml(s) {
  return String(s ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

export function stripEm(s) {
  return unescapeHtml(String(s ?? '').replace(/<[^>]*>/g, ''))
}

export function fmtDur(sec) {
  const n = Math.max(0, Math.round(Number(sec) || 0))
  const h = Math.floor(n / 3600)
  const m = Math.floor((n % 3600) / 60)
  const s = n % 60
  const pad = (x) => String(x).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export function parseDanmaku(xml) {
  const out = []
  const re = /<d\s+p="([^"]*)"[^>]*>([\s\S]*?)<\/d>/g
  let m
  while ((m = re.exec(String(xml ?? '')))) {
    const p = m[1].split(',')
    const t = Number(p[0])
    const text = unescapeHtml(m[2]).trim()
    if (!Number.isFinite(t) || !text) continue
    if (text.length > 60) continue
    out.push({ t, text })
  }
  out.sort((a, b) => a.t - b.t)
  return out
}

/** "12:34" → 754 */
function parseDur(x) {
  const m = String(x ?? '').match(/^(\d+):(\d{1,2})$/)
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0
}

function toVideo(v) {
  const stat = v?.stat ?? {}
  const owner = v?.owner ?? {}
  return {
    bvid: String(v?.bvid ?? ''),
    aid: Number(v?.aid) || 0,
    title: String(v?.title ?? '').trim(),
    duration: Number(v?.duration) || parseDur(v?.duration),
    up: String(owner.name ?? v?.author ?? '').trim(),
    mid: Number(owner.mid ?? v?.mid) || 0,
    view: Number(stat.view ?? v?.play) || 0,
    like: Number(stat.like ?? v?.like) || 0,
    reply: Number(stat.reply ?? v?.video_review) || 0,
    danmaku: Number(stat.danmaku ?? v?.danmaku) || 0,
    tname: String(v?.tname ?? '').trim(),
    pic: String(v?.pic ?? '').trim(),
  }
}

/** 允许从 Netscape cookies.txt 或 "a=1; b=2" 传入。 */
export function normalizeCookie(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  if (s.includes('\t')) {
    const pairs = []
    for (const line of s.split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue
      const p = line.split('\t')
      if (p.length >= 7 && p[5]) pairs.push(`${p[5]}=${p[6]}`)
    }
    return pairs.join('; ')
  }
  return s
}

/**
 * @param {{fetchImpl?:Function, now?:Function, random?:Function, timeoutMs?:number,
 *          minIntervalMs?:number, jitterMs?:number, log?:Function, cookie?:string}} [opts]
 */
export function createClient(opts = {}) {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  const now = opts.now ?? (() => Date.now())
  const random = opts.random ?? Math.random
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 12_000
  const logger = typeof opts.log === 'function' ? opts.log : () => {}
  const onRisk = typeof opts.onRisk === 'function' ? opts.onRisk : () => {}
  let cookie = normalizeCookie(opts.cookie)

  const minInt = () => {
    const v = Number(opts.minIntervalMs)
    return Number.isFinite(v) && v > 0 ? v : PACE.minIntervalMs
  }
  const jitInt = () => {
    if (opts.jitterMs !== undefined && opts.jitterMs !== null) {
      const v = Number(opts.jitterMs)
      return Number.isFinite(v) && v >= 0 ? v : PACE.jitterMs
    }
    return PACE.jitterMs
  }

  let buvid = ''
  let buvidFailAt = 0
  let mk = ''
  let mkAt = 0
  let lastReq = 0
  let chain = Promise.resolve()

  /** 串行 + 最小间隔 + 抖动。 */
  function throttle(fn) {
    const run = chain.then(async () => {
      const gap = minInt() + Math.floor(random() * Math.max(0, jitInt()))
      const wait = gap - (now() - lastReq)
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      lastReq = now()
      return fn()
    })
    chain = run.catch(() => {})
    return run
  }

  /** 请求头里的 cookie：匿名 buvid + 登录 cookie（写操作才带登录）。 */
  function cookieHeader() {
    return [/buvid3=/.test(cookie) ? '' : buvid, cookie].filter(Boolean).join('; ')
  }

  async function raw(url, o = {}) {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      const ck = cookieHeader()
      return await fetchImpl(url, {
        method: o.method ?? 'GET',
        body: o.body,
        signal: ctl.signal,
        headers: {
          'user-agent': UA,
          referer: o.referer ?? 'https://www.bilibili.com/',
          accept: 'application/json, text/plain, */*',
          'accept-language': 'zh-CN,zh;q=0.9',
          ...(o.body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
          ...(ck ? { cookie: ck } : {}),
        },
      })
    } finally {
      clearTimeout(t)
    }
  }

  async function ensureBuvid() {
    if (buvid) return true
    if (buvidFailAt && now() - buvidFailAt < 10 * 60_000) return false
    try {
      const r = await throttle(() => raw(`${API}/x/frontend/finger/spi`))
      const j = await r.json()
      const b3 = j?.data?.b_3
      const b4 = j?.data?.b_4
      if (!b3) {
        buvidFailAt = now()
        return false
      }
      buvid = `buvid3=${b3}${b4 ? `; buvid4=${b4}` : ''}`
      return true
    } catch (err) {
      buvidFailAt = now()
      logger('buvid failed', err?.message ?? err)
      return false
    }
  }

  async function ensureMk(force = false) {
    if (!force && mk && now() - mkAt < 6 * 3600_000) return true
    try {
      await ensureBuvid()
      const r = await throttle(() => raw(`${API}/x/web-interface/nav`))
      const j = await r.json()
      const w = j?.data?.wbi_img ?? {}
      const imgKey = String(w.img_url ?? '').split('/').pop()?.split('.')[0] ?? ''
      const subKey = String(w.sub_url ?? '').split('/').pop()?.split('.')[0] ?? ''
      if (!imgKey || !subKey) return false
      mk = mixinKey(imgKey, subKey)
      mkAt = now()
      return true
    } catch (err) {
      logger('wbi failed', err?.message ?? err)
      return false
    }
  }

  async function api(path, params = {}, o = {}) {
    if (now() < RISK.until) {
      return { ok: false, code: 'COOLDOWN', message: 'B 站这会儿不让我看了，过一会儿再说。', data: null }
    }
    try {
      let url = API + path
      if (o.signed) {
        if (!(await ensureMk(o.forceMk))) return { ok: false, code: 'NO_WBI', message: '取不到签名密钥', data: null }
        url += `?${signQuery(params, mk, Math.floor(now() / 1000))}`
      } else {
        if (!/(?:^|;\s*)buvid3=/.test(cookieHeader())) await ensureBuvid()
        const q = Object.keys(params)
          .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
          .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`)
          .join('&')
        if (q) url += `?${q}`
      }
      const r = await throttle(() => raw(url, { referer: o.referer }))
      const text = await r.text()
      let j
      try {
        j = JSON.parse(text)
      } catch {
        return { ok: false, code: 'BAD_JSON', message: `非 JSON（HTTP ${r.status}）`, data: null }
      }
      const code = j?.code
      if (code !== 0) {
        if (RISK_CODES.has(Number(code))) {
          if (o.signed && !o.retried) {
            logger(`签名接口 ${code}，刷新 wbi 后重试一次`)
            return api(path, params, { ...o, forceMk: true, retried: true })
          }
          const ms = noteRisk(now())
          try { onRisk(code) } catch { /* 落盘失败不影响本次 */ }
          logger(`风控代码 ${code}，${Math.ceil(ms / 1000)} 秒内不再请求`)
        }
        return { ok: false, code, message: j?.message ?? String(code), data: null }
      }
      noteOk()
      return { ok: true, code: 0, message: 'OK', data: j?.data ?? null }
    } catch (err) {
      return { ok: false, code: 'NETWORK', message: String(err?.message ?? err), data: null }
    }
  }

  /** csrf = cookie 里的 bili_jct；没有它所有写操作都会被拒。 */
  function csrf() {
    const m = /(?:^|;\s*)bili_jct=([^;]+)/.exec(String(cookie ?? ''))
    return m ? m[1] : ''
  }

  /** 写操作统一出口：POST 表单 + csrf。 */
  async function apiPost(path, form = {}, o = {}) {
    if (!cookie) return { ok: false, code: 'NOT_LOGIN', message: '没有登录凭据', data: null }
    const token = csrf()
    if (!token) return { ok: false, code: 'NO_CSRF', message: 'cookie 里没有 bili_jct，写不了', data: null }
    if (now() < RISK.until) {
      return { ok: false, code: 'COOLDOWN', message: 'B 站这会儿不让我说话，过一会儿再说。', data: null }
    }
    try {
      const body = new URLSearchParams({ ...form, csrf: token, csrf_token: token }).toString()
      const r = await throttle(() => raw(API + path, { referer: o.referer ?? 'https://www.bilibili.com/', method: 'POST', body }))
      const text = await r.text()
      let j
      try {
        j = JSON.parse(text)
      } catch {
        return { ok: false, code: 'BAD_JSON', message: `非 JSON（HTTP ${r.status}）`, data: null }
      }
      if (j?.code !== 0) {
        if (RISK_CODES.has(Number(j?.code))) {
          noteRisk(now())
          try { onRisk(j?.code) } catch { /* 落盘失败不影响本次 */ }
        }
        return { ok: false, code: j?.code, message: j?.message ?? String(j?.code), data: null }
      }
      noteOk()
      return { ok: true, code: 0, message: 'OK', data: j?.data ?? null }
    } catch (err) {
      return { ok: false, code: 'NETWORK', message: String(err?.message ?? err), data: null }
    }
  }

  // ---------------- 具体接口 ----------------

  /** 发一条视频评论（写，需登录 + bili_jct）。 */
  async function replyAdd(aid, message) {
    const msg = String(message ?? '').trim()
    if (!msg) return { ok: false, code: 'EMPTY', message: '评论是空的', data: null }
    if (msg.length > 1000) return { ok: false, code: 'TOO_LONG', message: '太长了（B 站上限 1000 字）', data: null }
    const r = await apiPost('/x/v2/reply/add', { oid: aid, type: 1, message: msg, plat: 1 }, {
      referer: `https://www.bilibili.com/video/av${aid}`,
    })
    if (!r.ok) return r
    return { ok: true, code: 0, message: 'OK', data: { rpid: Number(r.data?.rpid) || 0 } }
  }

  /** 回一条楼中楼。root=她那条主评论，parent=被回复的那条。 */
  async function replyReply(aid, rootRpid, parentRpid, message) {
    const msg = String(message ?? '').trim()
    if (!msg) return { ok: false, code: 'EMPTY', message: '回复是空的', data: null }
    if (msg.length > 1000) return { ok: false, code: 'TOO_LONG', message: '太长了（B 站上限 1000 字）', data: null }
    if (!rootRpid || !parentRpid) return { ok: false, code: 'NO_TARGET', message: '不知道在回哪一条', data: null }
    const r = await apiPost('/x/v2/reply/add', {
      oid: aid, type: 1, message: msg, root: rootRpid, parent: parentRpid, plat: 1,
    }, { referer: `https://www.bilibili.com/video/av${aid}` })
    if (!r.ok) return r
    return { ok: true, code: 0, message: 'OK', data: { rpid: Number(r.data?.rpid) || 0 } }
  }

  /** 一条主评论下面的楼中楼。 */
  async function subReplies(aid, rootRpid, { ps = 20, pn = 1 } = {}) {
    const r = await api('/x/v2/reply/reply', { type: 1, oid: aid, root: rootRpid, ps: Math.min(20, ps), pn })
    if (!r.ok) return { ...r, data: [] }
    const list = (r.data?.replies ?? []).map((x) => ({
      rpid: Number(x.rpid) || 0,
      mid: Number(x.mid) || 0,
      user: x.member?.uname ?? '',
      text: String(x.content?.message ?? ''),
      ctime: Number(x.ctime) || 0,
    }))
    return { ...r, data: list, total: r.data?.page?.count ?? 0 }
  }

  async function whoami() {
    const r = await api('/x/web-interface/nav')
    return {
      ok: Boolean(r.ok),
      isLogin: Boolean(r.data?.isLogin),
      uname: r.data?.uname ?? '',
      mid: Number(r.data?.mid) || 0,
    }
  }

  /** 是否已登录 + 能不能写（写操作前自检）。 */
  async function me() {
    if (!cookie) return { ok: false, isLogin: false, mid: 0, uname: '', canWrite: false, why: '没有 cookie' }
    const w = await whoami()
    return { ...w, canWrite: Boolean(w.isLogin && csrf()), why: w.isLogin ? (csrf() ? '' : 'cookie 里没有 bili_jct') : 'cookie 已失效' }
  }

  async function popular(ps = 20) {
    const r = await api('/x/web-interface/popular', { ps: Math.min(50, ps), pn: 1 })
    return r.ok ? { ...r, data: (r.data?.list ?? []).map(toVideo) } : { ...r, data: [] }
  }

  async function ranking(rid = 0, type = 'all') {
    const r = await api('/x/web-interface/ranking/v2', { rid, type })
    return r.ok ? { ...r, data: (r.data?.list ?? []).map(toVideo) } : { ...r, data: [] }
  }

  async function precious(pageSize = 20) {
    const r = await api('/x/web-interface/popular/precious', { page_size: Math.min(50, pageSize), page: 1 })
    return r.ok ? { ...r, data: (r.data?.list ?? []).map(toVideo) } : { ...r, data: [] }
  }

  async function search(keyword, { page = 1, pageSize = 10 } = {}) {
    const kw = String(keyword ?? '').trim().slice(0, 40)
    if (!kw) return { ok: false, code: 'EMPTY', message: '关键词是空的', data: [] }
    const r = await api(
      '/x/web-interface/search/type',
      { search_type: 'video', keyword: kw, page, page_size: Math.min(20, pageSize) },
      { signed: true, referer: `https://search.bilibili.com/all?keyword=${encodeURIComponent(kw)}` },
    )
    if (!r.ok) return { ...r, data: [] }
    const list = (r.data?.result ?? []).map((v) => ({ ...toVideo(v), title: stripEm(v.title) }))
    return { ...r, data: list }
  }

  async function related(bvid, limit = 10) {
    const r = await api('/x/web-interface/archive/related', { bvid })
    return r.ok ? { ...r, data: (r.data ?? []).slice(0, limit).map(toVideo) } : { ...r, data: [] }
  }

  async function view(bvid) {
    const r = await api('/x/web-interface/view', { bvid })
    if (!r.ok) return r
    const d = r.data ?? {}
    return {
      ok: true,
      code: 0,
      message: 'OK',
      data: {
        ...toVideo(d),
        desc: String(d.desc ?? ''),
        pubdate: d.pubdate ? new Date(Number(d.pubdate) * 1000).toISOString() : null,
        cid: d.pages?.[0]?.cid ?? null,
        replyCount: d.stat?.reply ?? 0,
      },
    }
  }

  async function tags(bvid) {
    const r = await api('/x/tag/archive/tags', { bvid })
    return r.ok ? { ...r, data: (r.data ?? []).map((t) => t.tag_name).filter(Boolean) } : { ...r, data: [] }
  }

  async function replies(aid, { sort = 2, ps = 10, pn = 1 } = {}) {
    const r = await api('/x/v2/reply', { type: 1, oid: aid, sort, ps: Math.min(20, ps), pn })
    if (!r.ok) return { ...r, data: [] }
    const list = (r.data?.replies ?? []).map((x) => ({
      rpid: Number(x.rpid) || 0,
      mid: Number(x.mid) || 0,
      like: Number(x.like) || 0,
      user: x.member?.uname ?? '',
      text: String(x.content?.message ?? ''),
      ctime: Number(x.ctime) || 0,
    }))
    return { ...r, data: list, total: r.data?.page?.count ?? 0 }
  }

  async function danmaku(cid) {
    if (!cid) return { ok: false, code: 'NO_CID', message: '没有 cid', data: [] }
    if (now() < RISK.until) {
      return { ok: false, code: 'COOLDOWN', message: 'B 站这会儿不让我看了，过一会儿再说。', data: [] }
    }
    try {
      const r = await throttle(() => raw(`${API}/x/v1/dm/list.so?oid=${cid}`, { referer: 'https://www.bilibili.com/' }))
      const buf = Buffer.from(await r.arrayBuffer())
      let xml = ''
      for (const fn of [inflateRawSync, inflateSync, gunzipSync]) {
        try {
          xml = fn(buf).toString('utf8')
          break
        } catch {
          /* 换下一种 */
        }
      }
      if (!xml) xml = buf.toString('utf8')
      return { ok: true, code: 0, message: 'OK', data: parseDanmaku(xml) }
    } catch (err) {
      return { ok: false, code: 'NETWORK', message: String(err?.message ?? err), data: [] }
    }
  }

  /** b23.tv / bilibili 链接 → bvid。只认视频链接。 */
  async function resolveUrl(url) {
    const rawUrl = /^https?:\/\//i.test(String(url)) ? String(url) : `https://${String(url)}`
    if (!/^(https?:\/\/)?(b23\.tv|bili2233\.cn|(www\.|m\.)?bilibili\.com)\//i.test(rawUrl)) {
      return { ok: false, code: 'NOT_VIDEO', message: '这个链接点开不是一条视频。', data: null }
    }
    try {
      const ctl = new AbortController()
      const t = setTimeout(() => ctl.abort(), timeoutMs)
      let finalUrl = rawUrl
      try {
        const r = await fetchImpl(rawUrl, {
          method: 'GET',
          redirect: 'follow',
          signal: ctl.signal,
          headers: { 'user-agent': UA, referer: 'https://www.bilibili.com/' },
        })
        finalUrl = String(r.url ?? rawUrl)
        try { await r.arrayBuffer() } catch { /* 只要地址 */ }
      } finally {
        clearTimeout(t)
      }
      const m = /BV[0-9A-Za-z]{8,12}/.exec(finalUrl)
      if (m) return { ok: true, code: 0, message: 'OK', data: { bvid: m[0] } }
      return { ok: false, code: 'NOT_VIDEO', message: '这个链接点开不是一条视频。', data: null }
    } catch (err) {
      return { ok: false, code: 'NETWORK', message: String(err?.message ?? err), data: null }
    }
  }

  return {
    popular, ranking, precious, search, related, view, tags, replies, danmaku, resolveUrl,
    subReplies, replyAdd, replyReply, whoami, me,
    setCookie(c) { cookie = normalizeCookie(c); return cookie },
    _internal: { ensureBuvid, ensureMk, csrf, get mk() { return mk }, get buvid() { return buvid }, get cookie() { return cookie } },
  }
}
