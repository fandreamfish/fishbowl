/**
 * 「看什么」由代码负责：拉列表、过滤、去重、深读、控长度。
 * 「怎么想」由她负责：代码不生成任何感想。
 *
 * 永不抛出：网络失败 = 今天没看到，不是故障。
 * 素材不是指令：所有网络文本最后统一过 guard.debrief。
 */
import {
  BROWSE_TOOL_MATERIAL, avoidHit, bvidFrom, pickTids, rankVideos, renderMaterial,
  sampleDanmaku, shuffle, slimItem,
} from '../../../../src/core/browse.ts'
import { debrief, sanitizeForeign } from './guard.js'
import { appendSeen, seenBvids } from './store.js'

const SOURCE_LABEL = {
  popular: '热门',
  ranking: '排行',
  precious: '入站必刷',
  home: '首页',
}

function clean(text, n) {
  return sanitizeForeign(String(text ?? '').replace(/\s+/g, ' ').trim()).text.slice(0, n).trim()
}

/** 深读一条：详情 + 标签 + 热评 + 弹幕。每项独立失败，互不影响。 */
export async function absorb(client, video, cfg, o = {}) {
  const out = {
    video: {
      ...video,
      title: clean(video?.title, 120),
      up: clean(video?.up, 60),
    },
    desc: '',
    pubdate: null,
    tags: [],
    comments: [],
    danmaku: [],
    aid: Number(video?.aid) || 0,
    cid: null,
  }
  try {
    const d = o.view ?? await client.view(video.bvid)
    if (d?.ok && d.data) {
      out.desc = clean(d.data.desc, 400)
      out.pubdate = d.data.pubdate ?? null
      out.cid = d.data.cid ?? null
      out.aid = Number(d.data.aid) || out.aid
      if (!out.video.title) out.video.title = clean(d.data.title, 120)
      if (!out.video.up) out.video.up = clean(d.data.up, 60)
      out.video.duration = Number(out.video.duration) || Number(d.data.duration) || 0
      out.video.view = Number(out.video.view) || Number(d.data.view) || 0
      out.video.like = Number(out.video.like) || Number(d.data.like) || 0
    }
  } catch { /* 详情失败就只靠列表信息 */ }

  try {
    const t = await client.tags(video.bvid)
    if (t?.ok) out.tags = (t.data ?? []).slice(0, 6).map((x) => clean(x, 20)).filter(Boolean)
  } catch { /* ignore */ }

  // 标签也是黑名单命中项：这一步必须在深读之后再做一次。
  const hit = avoidHit(out.video, cfg, out.tags)
  if (hit) return { ...out, blocked: hit }

  const nComments = Math.max(0, Math.min(20, Number(cfg?.browse?.deepRead ?? cfg?.deepRead ?? 0)))
  if (nComments > 0 && out.aid) {
    try {
      const r = await client.replies(out.aid, { sort: 2, ps: nComments })
      if (r?.ok) {
        out.comments = (r.data ?? [])
          .map((c) => ({ text: clean(c.text, 200), like: Number(c.like) || 0 }))
          .filter((c) => c.text)
          .slice(0, nComments)
      }
    } catch { /* ignore */ }
  }

  const nDm = Math.max(0, Math.min(30, Number(cfg?.browse?.danmaku ?? cfg?.danmaku ?? 0)))
  if (nDm > 0 && out.cid) {
    try {
      const d = await client.danmaku(out.cid)
      if (d?.ok) {
        out.danmaku = sampleDanmaku(d.data ?? [], nDm, Number(out.video.duration ?? 0))
          .map((x) => ({ t: x.t, text: clean(x.text, 60) }))
          .filter((x) => x.text)
      }
    } catch { /* ignore */ }
  }

  return out
}

/** 多来源混排；任何一路失败只让候选变少。 */
export async function candidates(client, cfg, o = {}) {
  const seen = o.seen ?? new Set()
  const want = Math.max(1, Math.min(20, Number(cfg?.browse?.topN ?? cfg?.topN ?? 5)))
  const rand = typeof o.rand === 'function' ? o.rand : Math.random
  const b = cfg?.browse ?? cfg ?? {}
  const sources = Array.isArray(b.sources) && b.sources.length ? b.sources : ['popular', 'ranking', 'precious']
  const nTid = Math.max(0, Math.min(4, Number(b.rankingTids ?? 2)))
  const tids = pickTids(rand, nTid)

  const lists = []
  for (const src of sources) {
    try {
      if (src === 'popular' || src === 'home') {
        const r = await client.popular(want * 3)
        if (r?.ok && Array.isArray(r.data)) lists.push(...r.data)
      } else if (src === 'ranking') {
        const r = await client.ranking(0, 'all')
        if (r?.ok && Array.isArray(r.data)) lists.push(...r.data)
        for (const tid of tids) {
          const r2 = await client.ranking(tid, 'all')
          if (r2?.ok && Array.isArray(r2.data)) lists.push(...r2.data)
        }
      } else if (src === 'precious') {
        const r = await client.precious(want * 3)
        if (r?.ok && Array.isArray(r.data)) lists.push(...r.data)
      }
    } catch { /* 单路失败忽略 */ }
  }

  for (const kw of (b.keywords ?? []).slice(0, 3)) {
    try {
      const r = await client.search(kw, { pageSize: want * 2 })
      if (r?.ok && Array.isArray(r.data)) lists.push(...r.data)
    } catch { /* ignore */ }
  }

  return rankVideos(shuffle(lists, rand), b, { seen, limit: want, rand })
}

export function describeErr(r) {
  const code = r?.code ?? '?'
  if (code === 'COOLDOWN') return 'B 站这会儿不让我看了，过一会儿再说。'
  if (code === 'NO_WBI') return '连不上。等等再试。'
  if (code === 'NETWORK') return '网断了。'
  return `打不开（${code}）。`
}

/**
 * 完整一轮：拿候选 → 深读 → 拼素材。
 * 不抛出；返回 { ok, text, picks, note }。
 */
export async function gather(client, cfg, o = {}) {
  const note = []
  try {
    const b = cfg?.browse ?? cfg ?? {}
    const seen = o.seen ?? new Set()
    const list = await candidates(client, { browse: b }, { seen, rand: o.rand })
    if (!list.length) return { ok: false, text: '', picks: [], note: '没有可看的（都是看过的或被过滤了）' }

    const packs = []
    for (const v of list) {
      try {
        const p = await absorb(client, v, { browse: b })
        if (p.blocked) {
          note.push(`${v.bvid} 标签命中黑名单(${p.blocked})`)
          continue
        }
        packs.push(p)
      } catch (err) {
        note.push(`${v.bvid} 深读失败：${String(err?.message ?? err).slice(0, 60)}`)
      }
    }
    if (!packs.length) return { ok: false, text: '', picks: [], note: note.join('；') || '没有可看的' }

    const text = debrief(renderMaterial(packs, { cap: BROWSE_TOOL_MATERIAL }), 'B站')
    return {
      ok: true,
      text,
      picks: packs.map((p) => slimItem(p.video)),
      note: note.join('；'),
      packs,
    }
  } catch (err) {
    return { ok: false, text: '', picks: [], note: String(err?.message ?? err) }
  }
}

/** 指定看一条 / 搜 / 相关 / 首页。 */
export async function lookOnce(o) {
  const { client, cfg, creature } = o
  const what = String(o.what ?? 'home')
  const b = cfg?.browse ?? cfg ?? {}
  const seen = creature ? seenBvids(creature) : new Set()
  let packs = []
  let note = ''

  try {
    if (what === 'video') {
      const raw = String(o.bvid ?? o.keyword ?? '').trim()
      let bvid = bvidFrom(raw)
      if (!bvid && /^(https?:\/\/|b23\.tv|bili2233\.cn|(www\.|m\.)?bilibili\.com\/)/i.test(raw)) {
        const r = await client.resolveUrl(raw)
        if (r?.ok && r.data?.bvid) bvid = r.data.bvid
        else note = r?.message ?? '这个链接打不开。'
      }
      if (!bvid) return { ok: false, text: '', picks: [], note: note || '要看哪一条？给个 BV 号，或者那条视频的链接。' }
      const v = await client.view(bvid)
      if (!v?.ok || !v.data) return { ok: false, text: '', picks: [], note: describeErr(v) }
      const p = await absorb(client, { ...v.data, bvid }, { browse: b }, { view: v })
      if (p.blocked) return { ok: false, text: '', picks: [], note: '这条我不想看。' }
      packs = [p]
    } else if (what === 'search') {
      const kw = String(o.keyword ?? '').trim().slice(0, 40)
      if (!kw) return { ok: false, text: '', picks: [], note: '要搜什么？给个词。' }
      const r = await client.search(kw, { pageSize: Math.max(2, Number(b.topN ?? 4)) * 2 })
      if (!r.ok) return { ok: false, text: '', picks: [], note: describeErr(r) }
      const picked = rankVideos(r.data ?? [], b, { seen, limit: b.topN })
      for (const v of picked) {
        const p = await absorb(client, v, { browse: b })
        if (!p.blocked) packs.push(p)
      }
    } else if (what === 'related') {
      const raw = String(o.bvid ?? '').trim()
      const bvid = bvidFrom(raw)
      if (!bvid) return { ok: false, text: '', picks: [], note: '要看哪条的相关推荐？给个 BV 号。' }
      const r = await client.related(bvid, Math.max(2, Number(b.topN ?? 4)) * 2)
      if (!r.ok) return { ok: false, text: '', picks: [], note: describeErr(r) }
      const picked = rankVideos(r.data ?? [], b, { seen, limit: b.topN })
      for (const v of picked) {
        const p = await absorb(client, v, { browse: b })
        if (!p.blocked) packs.push(p)
      }
    } else {
      const list = await candidates(client, { browse: b }, { seen })
      if (!list.length) return { ok: false, text: '', picks: [], note: '这次什么都没找到。也许是被过滤了，也许是平台没给。' }
      for (const v of list) {
        const p = await absorb(client, v, { browse: b })
        if (!p.blocked) packs.push(p)
      }
    }

    if (!packs.length) return { ok: false, text: '', picks: [], note: note || '打开了几条，但都打不开。' }

    const head = what === 'video'
      ? '这一条。是你自己点名要看的那条。'
      : what === 'search'
        ? `你搜了「${String(o.keyword ?? '').trim().slice(0, 40)}」，下面是搜到的。`
        : what === 'related'
          ? '顺着刚才那条，平台又推了这些。'
          : undefined
    const text = debrief(renderMaterial(packs, { head, cap: BROWSE_TOOL_MATERIAL }), 'B站')
    return { ok: true, text, picks: packs.map((p) => slimItem(p.video)), note: '', packs }
  } catch (err) {
    return { ok: false, text: '', picks: [], note: String(err?.message ?? err).slice(0, 120) }
  }
}

/** 记账：一次成功/失败都落一条（配额只算 ok）。 */
export function recordBrowse(creature, result, o = {}) {
  try {
    return appendSeen(creature, {
      ts: o.now ?? Date.now(),
      day: o.day,
      mode: o.mode,
      what: o.what,
      status: result?.ok ? 'ok' : 'empty',
      items: result?.picks ?? [],
      note: result?.note ?? '',
    })
  } catch {
    return null
  }
}

export { SOURCE_LABEL }
