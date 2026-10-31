/**
 * 设置页后端（M7）：鱼是第一公民。
 *
 * 路由（同源）：
 *   GET  /fish                     列表（含住处、状态、记忆、请求数）
 *   POST /fish                     生一条新鱼（可带住处）
 *   POST /fish/:id/occupy          搬进工作区/会话（互斥，冲突 409）
 *   POST /fish/:id/release         搬出去（不归任何会话）
 *   GET  /fish/:id/diary           日记
 *   GET  /fish/:id/notes           小纸条
 *   GET  /fish/:id/requests        请求（含历史与答复）
 *   POST /fish/:id/requests/:rid/answer  补答 {answer:'yes'|'no'}
 *   GET/POST /config               成长率与来历（来历出生后只读）
 */
import fs from 'node:fs'
import path from 'node:path'
import { renameScopeAsync, restoreOriginalAsync } from './rename.js'
import { injectMessage } from './injector.js'
import { normalizeConfig } from './config.js'
import { createDshHost, workspaceOf } from '../host/dsh.js'
import { generateProactive, wakeStatePath } from './life.js'
import { buildView } from '../../memory/src/records.ts'
import { validateMemory } from '../../memory/src/config.ts'

const ROUTE = '/fishbowl-ui'

/** 事件 → 一行摘要（给时间线用）。 */
export function summarizeEvent(e) {
  switch (e.t) {
    case 'episode': return { text: (e.note ?? '').slice(0, 80) || '（一轮对话）', meta: `v=${Number(e.appraisal?.goalCongruence ?? 0).toFixed(2)}` }
    case 'semantic': return { text: e.claim, meta: `置信 ${Number(e.confidence).toFixed(2)}` }
    case 'procedure': return { text: `${e.trigger} → ${e.action}`, meta: `置信 ${Number(e.confidence).toFixed(2)}` }
    case 'self': return { text: e.claim, meta: `证据 ${e.evidence?.length ?? 0}` }
    case 'commitment': return { text: e.text, meta: '承诺' }
    case 'commitment-resolved': return { text: e.ref.slice(0, 8), meta: e.status === 'broken' ? '违诺' : '已兑现' }
    case 'activity': return { text: e.title, meta: e.status === 'started' ? '开始' : '结束' }
    case 'identity': return { text: e.name, meta: '名字' }
    case 'diary': return { text: e.text.slice(0, 60), meta: '日记' }
    case 'note': return { text: e.text, meta: '小纸条' }
    case 'request': return { text: e.text, meta: '请求' }
    case 'request-answered': return { text: e.ref.slice(0, 8), meta: e.answer === 'yes' ? '同意' : '不同意' }
    case 'reinforce': return { text: e.ref.slice(0, 8), meta: '又提到' }
    case 'freeze': return { text: '封存', meta: '' }
    case 'unfreeze': return { text: '解封', meta: '' }
    default: return { text: e.t, meta: '' }
  }
}

/** 合并 UI 保存的配置（ui-config.json）到配置对象。 */
export function mergeUiConfig(raw, ui) {
  if (!ui || typeof ui !== 'object') return raw
  const out = { ...raw }
  if (typeof ui.growth === 'number' && Number.isFinite(ui.growth)) out.growth = ui.growth
  if (ui.seed && typeof ui.seed === 'object') out.seed = { name: String(ui.seed.name ?? ''), background: String(ui.seed.background ?? '') }
  if (ui.memory && typeof ui.memory === 'object') out.memory = { ...(raw.memory || {}), ...ui.memory }
  if (ui.wake && typeof ui.wake === 'object') out.wake = pickRoutineConfig({ wake: ui.wake }).wake
  if (ui.contact && typeof ui.contact === 'object') out.contact = pickRoutineConfig({ contact: ui.contact }).contact
  if (ui.relation && typeof ui.relation === 'object' && typeof ui.relation.kind === 'string') {
    out.relation = { kind: ['companion', 'friend'].includes(ui.relation.kind) ? ui.relation.kind : 'companion' }
  }
  return out
}

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
export function validateMemoryConfig(c) {
  return validateMemory(c)
}

// —— 记忆系统视图（docs/MEMORY.md） ——

const RELATION_RE = /我们|关系|信任|约定|答应|承诺|感情|亲密/

/** 这条认知是谁的事。新结构里由模型给，旧结构里只能按字面猜（关系词优先）。 */
export function subjectOf(text) {
  const s = String(text ?? '')
  if (RELATION_RE.test(s)) return 'between'
  if (/^(用户|他)/.test(s)) return 'user'
  if (/^(AI|我（AI）|我自己)/.test(s) || /AI\s*(会|在|给|对|把)/.test(s)) return 'self'
  return 'world'
}

/** 旧认知（semantic / procedure / self）→ 统一的记忆视图。 */
function legacyClaimView(e, reinforces) {
  const text = e.t === 'procedure' ? `${e.trigger} → ${e.action}` : String(e.claim ?? '')
  const kind = e.t === 'semantic' ? (RELATION_RE.test(text) ? 'relation' : 'fact') : e.t === 'procedure' ? 'lesson' : 'self'
  return {
    id: e.id,
    kind,
    subject: e.t === 'self' ? 'self' : subjectOf(text),
    claim: text,
    attitude: null,
    tags: [],
    evidence: Array.isArray(e.evidence) ? e.evidence.map(String) : [],
    evidenceMode: 'lines', // 旧格式：提示词行号，无法回溯到 episode
    confidence: Number(e.confidence ?? 0.5),
    reinforcements: reinforces.get(e.id) ?? 0,
    status: e.status ?? 'active',
    createdAt: e.ts,
    affectPeak: null,
    affectAtWrite: null,
    by: null,
    supersedes: null,
  }
}

/** 旧 episode → turn 记录视图。 */
function legacyTurnView(e) {
  const note = typeof e.note === 'string' ? e.note : ''
  return {
    id: e.id,
    occurredAt: e.ts,
    neutral: note,
    her: [],
    tags: [],
    affectPeak: null,
    salience: Number(e.salience ?? 0),
    hits: { considered: 0, used: 0 },
    summaryState: note ? 'neutral' : 'none',
    scope: null,
    rawText: null,
    legacy: true,
  }
}

/** 有没有另一个活着的进程也在写这只鱼（双写会让一个人变成两个）。 */
export function otherWriter(dir) {
  try {
    const o = JSON.parse(fs.readFileSync(path.join(dir, '.writer.lock'), 'utf8'))
    const pid = Number(o?.pid)
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return null
    try {
      process.kill(pid, 0)
      return { pid, at: Number(o?.at) || 0 }
    } catch (e) {
      return e?.code === 'EPERM' ? { pid, at: Number(o?.at) || 0 } : null
    }
  } catch {
    return null
  }
}

/** 新结构：账本投影 → 设置页视图（字段名与前端约定一致）。 */
function newDetail(events, cfg, dir) {
  const v = buildView(events)
  const turns = v.turns
    .slice()
    .reverse()
    .map((t) => ({
      id: t.id,
      occurredAt: t.ts,
      neutral: t.neutral,
      her: t.her,
      tags: t.tags,
      affectPeak: t.affectPeak,
      salience: t.salience,
      hits: t.hits,
      summaryState: t.summaryState,
      scope: t.scope,
      rawText: t.note,
      legacy: false,
    }))
  const memories = v.memories.map((m) => ({ ...m, evidenceMode: 'turns' }))

  const byKind = { fact: 0, lesson: 0, relation: 0, self: 0 }
  let active = 0
  let retired = 0
  for (const m of memories) {
    if (byKind[m.kind] !== undefined) byKind[m.kind] += 1
    if (m.status === 'retired') retired += 1
    else active += 1
  }

  memories.sort((a, b) => (a.status === b.status ? (b.createdAt || 0) - (a.createdAt || 0) : a.status === 'retired' ? 1 : -1))

  return {
    view: 'new',
    config: cfg.memory ?? null,
    stats: {
      events: events.length,
      turnTotal: v.turns.length,
      memoryTotal: memories.length,
      active,
      retired,
      byKind,
      pending: Math.max(0, v.turns.length - v.watermark),
      watermark: v.watermark,
      lock: dir ? otherWriter(dir) : null,
    },
    memories: memories.slice(0, 1000),
    turns: turns.slice(0, 500),
  }
}

/** 旧结构：只有 episode / semantic / procedure 时，映射成同一套视图（明确标注是旧格式）。 */
function legacyDetail(events, cfg) {
  const reinforces = new Map()
  for (const e of events) if (e.t === 'reinforce' && e.ref) reinforces.set(e.ref, (reinforces.get(e.ref) || 0) + 1)

  const memories = []
  const turns = []
  for (const e of events) {
    if (e.t === 'semantic' || e.t === 'procedure' || e.t === 'self') memories.push(legacyClaimView(e, reinforces))
    else if (e.t === 'episode') turns.push(legacyTurnView(e))
  }

  const byKind = { fact: 0, lesson: 0, relation: 0, self: 0 }
  let active = 0
  let retired = 0
  for (const m of memories) {
    if (byKind[m.kind] !== undefined) byKind[m.kind] += 1
    if (m.status === 'retired') retired += 1
    else active += 1
  }

  memories.sort((a, b) => (a.status === b.status ? (b.createdAt || 0) - (a.createdAt || 0) : a.status === 'retired' ? 1 : -1))
  turns.sort((a, b) => (b.occurredAt || 0) - (a.occurredAt || 0))

  return {
    view: 'legacy',
    config: cfg.memory ?? null,
    stats: {
      events: events.length,
      turnTotal: turns.length,
      memoryTotal: memories.length,
      active,
      retired,
      byKind,
      // 旧结构没有水位线概念，不假装有待整理
      pending: null,
    },
    memories: memories.slice(0, 1000),
    turns: turns.slice(0, 500),
  }
}

/**
 * 记忆详情视图：配置之外的一切。
 * 新结构（turn / merged）存在时优先用它；否则把旧的 episode / semantic / procedure 映射过来。
 */
export function memoryDetail(creature, cfg) {
  const events = creature.store.readEvents()
  const hasNew = events.some((e) => e.t === 'turn' || e.t === 'merged')
  return hasNew ? newDetail(events, cfg, creature.store.dir) : legacyDetail(events, cfg)
}


export function uiConfigPath(stateDir) {
  return path.join(stateDir, 'ui-config.json')
}

/** 读-改-写 UI 配置（保留不认识的键，避免存记忆配置时把成长率冲掉）。 */
export function saveUiConfig(stateDir, patch) {
  let cur = {}
  try { cur = JSON.parse(fs.readFileSync(uiConfigPath(stateDir), 'utf8')) } catch { /* 首次 */ }
  const next = { ...(cur && typeof cur === 'object' ? cur : {}), ...patch }
  fs.writeFileSync(uiConfigPath(stateDir), JSON.stringify(next, null, 2))
  return next
}

/** seed 是否被这次请求改动（纯函数，便于测试）。 */
export function seedChanged(prev, next) {
  return !!next && (String(next.name ?? '') !== String(prev?.name ?? '') || String(next.background ?? '') !== String(prev?.background ?? ''))
}

export function createUiRoute(ctx, cfg, binding, host, opts = {}) {
  host = host ?? createDshHost(ctx, cfg)
  if (typeof host.registerRoute !== 'function') return () => {}
  const stateDir = cfg.stateDir

  function fishView(c, sessions) {
    const affect = c.fold().affect
    const events = c.store.readEvents()
    const mv = memoryDetail(c, cfg)
    const rank = (list) => list
      .filter((m) => m.status === 'active')
      .sort((a, b) => (b.reinforcements - a.reinforcements) || (b.confidence - a.confidence))
    const memory = {
      name: c.meta.name && !c.meta.name.startsWith('fish-') ? c.meta.name : null,
      semantics: rank(mv.memories.filter((m) => m.kind === 'fact' || m.kind === 'relation')).slice(0, 3).map((m) => m.claim),
      procedures: rank(mv.memories.filter((m) => m.kind === 'lesson')).slice(0, 2).map((m) => m.claim),
      self: rank(mv.memories.filter((m) => m.kind === 'self')).slice(0, 2).map((m) => m.claim),
      commitments: c.openCommitments(cfg.growth).slice(-2).map((x) => (x.broken ? '⚠ ' : '') + x.text),
      activity: c.currentActivity(cfg.growth),
      folded: mv.stats.retired,
      requests: c.requestDigest(),
    }
    return {
      id: c.meta.creatureId,
      name: c.meta.name,
      bornAt: c.meta.bornAt,
      frozen: c.isFrozen(),
      occupancy: c.meta.occupancy
        ? { ...c.meta.occupancy, workspace: c.meta.occupancy.kind === 'session' ? (c.meta.occupancy.workspace || (sessions || []).find(s => s.id === c.meta.occupancy.id)?.workspace || '') : undefined }
        : null,
      episodes: events.filter((e) => e.t === 'episode' || e.t === 'turn').length,
      affect: { v: affect.valence, a: affect.arousal, guilt: affect.guilt, longing: affect.longing },
      memory,
      pendingRequests: c.pendingRequests(),
      requests: c.requests().slice(-10).reverse(),
      notes: c.notes(5),
      diary: c.diaries(3),
      metaBytes: JSON.stringify(c.meta).length,
      outbox: c.store.readOutbox().filter(o => !o.delivered).length,
      events: events.slice(-40).map(e => ({ t: e.t, ts: e.ts, ...summarizeEvent(e) })),
    }
  }

  /** 枚举结果 + 插件已记录的住处（两边互补）。枚举本身在 host 适配器里。 */
  function allScopes() {
    const e = host.listScopes()
    const workspaces = [...e.workspaces]
    for (const w of (binding.scopes?.workspaces ?? [])) if (!workspaces.includes(w)) workspaces.push(w)
    const sessions = [...e.sessions]
    for (const s of (binding.scopes?.sessions ?? [])) {
      if (s && s.id && !sessions.some(x => x.id === s.id)) sessions.push({ id: s.id, workspace: s.workspace || '' })
    }
    return { workspaces, sessions }
  }
  function stateView() {
    const scopes = allScopes()
    const fish = binding.listCreatures().map((c) => fishView(c, scopes.sessions))
    return {
      born: fish.some(f => f.episodes > 0),
      scopes,
      wakeState: (() => { try { return JSON.parse(fs.readFileSync(wakeStatePath(stateDir), 'utf8')) } catch { return null } })(),
      config: { growth: cfg.growth, seed: cfg.seed ?? null, appraiser: cfg.appraiser?.kind, relation: cfg.relation, wake: cfg.wake, contact: cfg.contact, memory: cfg.memory },
      fish,
    }
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', reject)
    })
  }

  const send = (res, obj, code = 200) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(obj))
  }

  let dispose
  try {
    dispose = host.registerRoute({
      kind: 'prefix',
      path: ROUTE,
      handler: async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const sub = url.pathname.slice(ROUTE.length)
          const parts = sub.split('/').filter(Boolean)

          // —— 鱼列表 / 新生 ——
          if (parts[0] === 'fish' && parts.length === 1 && req.method === 'GET') return send(res, stateView())
          if (parts[0] === 'fish' && parts.length === 1 && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}')
            const name = String(body.name ?? '').trim()
            if (!name) return send(res, { ok: false, error: '先给它起个名字' }, 400)
            const occ = body.occupancy && body.occupancy.kind
              ? { kind: body.occupancy.kind, id: String(body.occupancy.id ?? ''), workspace: body.occupancy.workspace ? String(body.occupancy.workspace) : undefined }
              : null
            if (occ) {
              const conflict = binding.conflictFor('', occ)
              if (conflict) return send(res, { ok: false, error: `这个住处已经住着「${conflict.name}」了` }, 409)
            }
            const c = binding.birth(name, occ)
            if (occ) renameScopeAsync(host, stateDir, occ, name)
            return send(res, { ok: true, fish: fishView(c) })
          }

          // —— 单条鱼 ——
          if (parts[0] === 'fish' && parts.length >= 3) {
            const c = binding.get(parts[1])
            if (!c) return send(res, { ok: false, error: '找不到这条鱼' }, 404)
            const action = parts[2]
            if (action === 'occupy' && req.method === 'POST') {
              const body = JSON.parse(await readBody(req) || '{}')
              if (body.kind !== 'workspace' && body.kind !== 'session') return send(res, { ok: false, error: '住处类型不对' }, 400)
              const occ = body.kind === 'workspace'
                ? { kind: 'workspace', id: String(body.id ?? '') }
                : { kind: 'session', id: String(body.id ?? ''), workspace: body.workspace ? String(body.workspace) : undefined }
              if (!occ.id) return send(res, { ok: false, error: '住处的 id 不能为空' }, 400)
              try {
                const c0 = binding.get(parts[1])
                const prev = c0.meta.occupancy
                binding.assign(parts[1], occ)
                if (prev && (prev.kind !== occ.kind || prev.id !== occ.id)) restoreOriginalAsync(host, stateDir, prev)
                renameScopeAsync(host, stateDir, occ, c0.meta.name)
                return send(res, { ok: true, fish: fishView(binding.get(parts[1])) })
              } catch (e) {
                return send(res, { ok: false, error: String(e?.message ?? e) }, e?.code === 'OCCUPIED' ? 409 : 400)
              }
            }
            if (action === 'name' && req.method === 'POST') {
              const body = JSON.parse(await readBody(req) || '{}')
              const name = String(body.name ?? '').trim()
              if (!name) return send(res, { ok: false, error: '名字不能为空' }, 400)
              // 只允许给还没名字的鱼（默认 fish-xxxx）起名一次
              if (!/^fish-/.test(c.meta.name)) return send(res, { ok: false, error: '名字已经定过了' }, 409)
              c.recordIdentity(name)
              return send(res, { ok: true, fish: fishView(c) })
            }
            if (action === 'delete' && req.method === 'POST') {
              const prev = c.meta.occupancy
              binding.remove(parts[1])
              if (prev) restoreOriginalAsync(host, stateDir, prev)
              return send(res, { ok: true })
            }
            if (action === 'release' && req.method === 'POST') {
              const prev = c.meta.occupancy
              binding.release(parts[1])
              if (prev) restoreOriginalAsync(host, stateDir, prev)
              return send(res, { ok: true, fish: fishView(binding.get(parts[1])) })
            }
            if (action === 'diary' && req.method === 'GET') return send(res, { ok: true, diary: c.diaries(30) })
            if (action === 'notes' && req.method === 'GET') return send(res, { ok: true, notes: c.notes(30) })
            if (action === 'memory' && req.method === 'GET' && parts.length === 3) return send(res, { ok: true, ...memoryDetail(c, cfg) })
            if (action === 'requests' && req.method === 'GET') return send(res, { ok: true, requests: c.requests().slice(-30).reverse() })
            if (action === 'requests' && parts.length >= 5 && parts[4] === 'answer' && req.method === 'POST') {
              const body = JSON.parse(await readBody(req) || '{}')
              if (body.answer !== 'yes' && body.answer !== 'no') return send(res, { ok: false, error: 'answer 只能是 yes 或 no' }, 400)
              c.answerRequest(parts[3], body.answer)
              return send(res, { ok: true, requests: c.requests().slice(-30).reverse() })
            }
          }

          // —— 记忆配置（全局；改的是她的记忆行为，不是单个会话） ——
          if (parts[0] === 'memory' && parts[1] === 'config') {
            if (req.method === 'GET') return send(res, { ok: true, config: cfg.memory })
            if (req.method === 'POST') {
              const body = JSON.parse(await readBody(req) || '{}')
              const merged = { ...cfg.memory, ...pickMemoryConfig(body) }
              const errors = validateMemoryConfig(merged)
              if (errors.length) return send(res, { ok: false, error: errors.join('；') }, 400)
              // 再走一次归一化：钳制越界值，补齐缺失键
              cfg.memory = normalizeConfig({ ...cfg, memory: merged }).memory
              saveUiConfig(stateDir, { memory: cfg.memory })
              return send(res, { ok: true, config: cfg.memory })
            }
          }

          // —— 现在叫一次（测试用，绕过配额） ——
          if (sub === '/wake/now' && req.method === 'POST') {
            let target = null
            let creature = null
            for (const a of host.listAgents?.() ?? []) {
              const sid = a?.session?.id ?? a?.id
              if (!sid) continue
              const c = binding.resolve({ sessionId: sid, workspace: workspaceOf(a?.session) })
              if (c) { target = a; creature = c; break }
            }
            if (!target || !creature) return send(res, { ok: false, error: '没有活着的会话' }, 400)
            const reason = '你想主动找他（手动触发）'
            const text = await generateProactive(cfg, creature, reason)
            if (!text) return send(res, { ok: false, error: '生成失败' }, 500)
            try {
              await host.wake(target, injectMessage(text))
              fs.appendFileSync(path.join(stateDir, 'trace.ndjson'), JSON.stringify({ ts: Date.now(), event: 'wake-manual', creature: creature.meta.name, text }) + '\n')
              return send(res, { ok: true, text })
            } catch (e) {
              return send(res, { ok: false, error: String(e?.message ?? e) }, 500)
            }
          }
          // —— 诊断：服务可用性（排查改名问题用） ——
          if (sub === '/debug/services' && req.method === 'GET') {
            const svc = host.services()
            return send(res, svc)
          }

          // —— 兼容旧路径 ——
          if (sub === '/state' && req.method === 'GET') return send(res, stateView())
          if (sub === '/config' && req.method === 'GET') return send(res, { growth: cfg.growth, seed: cfg.seed ?? null, memory: cfg.memory, wake: cfg.wake, contact: cfg.contact, relation: cfg.relation })
          if (sub === '/config' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}')
            const ui = mergeUiConfig({}, body)
            // 公理 A1：她出生后来历只读——历史会被铭记，只能说服，不能修改
            if (stateView().born && seedChanged(cfg.seed, ui.seed)) {
              return send(res, { ok: false, error: '她已经出生了，来历不能再改（历史会被铭记，只能说服不能修改）' }, 409)
            }
            const routine = pickRoutineConfig(body)
            saveUiConfig(stateDir, {
              growth: ui.growth,
              seed: ui.seed ?? null,
              wake: { ...cfg.wake, ...(routine.wake ?? {}) },
              contact: { ...cfg.contact, ...(routine.contact ?? {}) },
              relation: ui.relation ?? cfg.relation,
            })
            if (typeof ui.growth === 'number') cfg.growth = ui.growth
            if (ui.seed && !stateView().born) cfg.seed = ui.seed
            if (routine.wake) cfg.wake = { ...cfg.wake, ...routine.wake }
            if (routine.contact) cfg.contact = { ...cfg.contact, ...routine.contact }
            if (ui.relation) cfg.relation = ui.relation
            // 节律开关/时段是启动时读的：改了就重启唤醒循环
            if (routine.wake) { try { opts.restartWake?.() } catch { /* 忽略 */ } }
            return send(res, { ok: true, growth: cfg.growth, seed: cfg.seed ?? null, memory: cfg.memory, wake: cfg.wake, contact: cfg.contact, relation: cfg.relation })
          }

          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('not found')
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end(String(e?.message ?? e))
        }
      },
    })
  } catch {
    // 同一路由被另一个实例注册过（例如条目重复加载）：不影响功能，另一个实例会服务
    return () => {}
  }
  return typeof dispose === 'function' ? dispose : () => {}
}
