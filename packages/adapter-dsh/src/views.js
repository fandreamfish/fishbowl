/**
 * 设置页读模型：把账本 + 配置转成前端要的 JSON。
 * 不处理请求，不做写入——只读。
 */
import fs from 'node:fs'
import { fishConfigView, hasFishConfig } from '../../app/src/fishcfg.js'
import { wakeStatePath } from '../../app/src/wake.js'
import { browseStatus } from '../../bilibili/src/runtime.js'
import { memoryDetail } from './views-memory.js'

export function createViews({ cfg, binding, host, stateDir }) {
  function fishView(c, sessions) {
    const fcfg = fishConfigView(cfg, c)
    const affect = c.affectNow ? c.affectNow() : c.fold().affect
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
      config: fcfg,
      configInherited: !hasFishConfig(cfg.stateDir, c.meta.creatureId),
      frozen: c.isFrozen(),
      occupancy: c.meta.occupancy
        ? { ...c.meta.occupancy, workspace: c.meta.occupancy.kind === 'session' ? (c.meta.occupancy.workspace || (sessions || []).find((s) => s.id === c.meta.occupancy.id)?.workspace || '') : undefined }
        : null,
      episodes: events.filter((e) => e.t === 'episode' || e.t === 'turn').length,
      affect: { v: affect.valence, a: affect.arousal, guilt: affect.guilt, longing: affect.longing },
      memory,
      browse: browseStatus(c, cfg),
      pendingRequests: c.pendingRequests(),
      requests: c.requests().slice(-10).reverse(),
      notes: c.notes(5),
      diary: c.diaries(3),
      metaBytes: JSON.stringify(c.meta).length,
      outbox: c.store.readOutbox().filter((o) => !o.delivered).length,
      events: events.slice(-40).map((e) => ({ t: e.t, ts: e.ts, ...summarizeEvent(e) })),
    }
  }

  /** 枚举结果 + 插件已记录的住处（两边互补）。枚举本身在 host 适配器里。 */
  function allScopes() {
    const e = host.listScopes()
    const workspaces = [...e.workspaces]
    for (const w of (binding.scopes?.workspaces ?? [])) if (!workspaces.includes(w)) workspaces.push(w)
    const sessions = [...e.sessions]
    for (const s of (binding.scopes?.sessions ?? [])) {
      if (s && s.id && !sessions.some((x) => x.id === s.id)) sessions.push({ id: s.id, workspace: s.workspace || '' })
    }
    return { workspaces, sessions }
  }

  function stateView() {
    const scopes = allScopes()
    const fish = binding.listCreatures().map((c) => fishView(c, scopes.sessions))
    return {
      born: fish.some((f) => f.episodes > 0),
      scopes,
      wakeState: (() => { try { return JSON.parse(fs.readFileSync(wakeStatePath(stateDir), 'utf8')) } catch { return null } })(),
      config: { growth: cfg.growth, seed: cfg.seed ?? null, appraiser: cfg.appraiser?.kind, relation: cfg.relation, wake: cfg.wake, contact: cfg.contact, selfTime: cfg.selfTime, browse: cfg.browse, comment: cfg.comment, memory: cfg.memory },
      fish,
    }
  }

  return { fishView, allScopes, stateView }
}

/** 事件 → 一行摘要（给时间线用）。 */
export function summarizeEvent(e) {
  switch (e.t) {
    case 'episode': return { text: (e.note ?? '').slice(0, 80) || '（一轮对话）', meta: `v=${Number(e.appraisal?.goalCongruence ?? 0).toFixed(2)}` }
    case 'semantic': return { text: e.claim, meta: `置信 ${Number(e.confidence).toFixed(2)}` }
    case 'procedure': return { text: `${e.trigger} → ${e.action}`, meta: `置信 ${Number(e.confidence).toFixed(2)}` }
    case 'self': return { text: e.claim, meta: `证据 ${e.evidence?.length ?? 0}` }
    case 'commitment': return { text: e.text, meta: e.status === 'broken' ? '违诺' : '承诺' }
    case 'identity': return { text: `名字：${e.name}`, meta: '起名' }
    case 'activity': return { text: e.title ?? '', meta: e.status === 'started' ? '开始' : '结束' }
    case 'diary': return { text: e.text.slice(0, 60), meta: '日记' }
    case 'note': return { text: e.text, meta: '小纸条' }
    case 'request': return { text: e.text, meta: '请求' }
    case 'request-answered': return { text: e.ref.slice(0, 8), meta: e.answer === 'yes' ? '同意' : '不同意' }
    case 'repair': return { text: '被原谅了一次', meta: '愧疚 -' + Number(e.amount ?? 0).toFixed(2) }
    case 'grant': return { text: e.text, meta: e.allowed ? `允许：${e.topic}` : `撤销：${e.topic}` }
    case 'wake': return { text: e.mode === 'self' ? '自己醒来' : '想找他', meta: e.reason ?? '' }
    case 'reinforce': return { text: e.ref.slice(0, 8), meta: '又提到' }
    case 'freeze': return { text: '封存', meta: '' }
    case 'unfreeze': return { text: '解封', meta: '' }
    default: return { text: e.t, meta: '' }
  }
}
