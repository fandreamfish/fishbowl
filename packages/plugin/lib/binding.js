/**
 * 住处解析（M7）：会话 → 鱼。
 *
 * 与旧版（bindings.json 会话→个体写死）的区别：
 *   - 鱼是第一公民，住处是**鱼自己的属性**（meta.occupancy）
 *   - 解析优先级：会话级 > 工作区级；都没有 = 没有鱼
 *   - 一个工作区/会话只能住一只鱼（互斥在 assign 时检查）
 *   - 自动出生：没鱼住的会话第一次使用时，生一只并住进这个会话（可随时搬走）
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Creature } from '../../../src/core/creature.ts'
import { DEFAULT_TEMPERAMENT } from '../../../src/core/types.ts'
import { mulberry32 } from '../../../src/core/util.ts'
import { findConflict, resolveOccupant } from '../../../src/core/tenancy.ts'
import { halfLivesFor, wakingFor } from './fishcfg.js'

/** @param {import('./types.js').FishbowlConfig} cfg */
export function createBinding(cfg) {
  fs.mkdirSync(cfg.stateDir, { recursive: true })
  const scopesPath = path.join(cfg.stateDir, 'scopes.json')
  const cache = new Map() // creatureId -> Creature
  const biasCache = new Map() // creatureId -> { ts, bias }
  /** 见过的住处（工作区路径 / 会话），供设置页选择。 */
  let scopes = { workspaces: [], sessions: [{ id: '', workspace: '' }] }
  try {
    const raw = JSON.parse(fs.readFileSync(scopesPath, 'utf8'))
    scopes = { workspaces: raw.workspaces ?? [], sessions: raw.sessions ?? [] }
  } catch { /* 首次运行 */ }
  // 清理占位
  scopes.sessions = scopes.sessions.filter(s => s && s.id)
  scopes.workspaces = [...new Set(scopes.workspaces.filter(Boolean))]
  let scopesDirty = false

  function saveScopes() {
    try {
      fs.writeFileSync(scopesPath, JSON.stringify(scopes, null, 2))
      scopesDirty = false
    } catch { /* 写失败不影响主流程 */ }
  }

  /** 记下这次见到的住处。 */
  function noteScope(sessionId, workspace) {
    if (workspace && !scopes.workspaces.includes(workspace)) { scopes.workspaces.push(workspace); scopesDirty = true }
    const hit = scopes.sessions.find(s => s.id === sessionId)
    if (!hit) { scopes.sessions.push({ id: sessionId, workspace: workspace ?? '' }); scopesDirty = true }
    else if (workspace && hit.workspace !== workspace) { hit.workspace = workspace; scopesDirty = true }
    if (scopesDirty) saveScopes()
  }

  /** 旧的 bindings.json（会话→个体）迁移：把住处写进各自的 meta，然后退役旧文件。 */
  function migrateLegacyBindings() {
    const legacyPath = path.join(cfg.stateDir, 'bindings.json')
    if (!fs.existsSync(legacyPath)) return
    try {
      const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8'))
      for (const [sessionId, cid] of Object.entries(legacy)) {
        const c = get(cid)
        if (c && !c.meta.occupancy) c.setOccupancy({ kind: 'session', id: sessionId })
      }
      fs.renameSync(legacyPath, legacyPath + '.legacy')
    } catch { /* 迁移失败不阻塞 */ }
  }

  /** 所有个体（读 meta 的住处），按出生时间排序。 */
  function listCreatures() {
    const out = []
    let names = []
    try {
      names = fs.readdirSync(cfg.stateDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('.'))
        .map(d => d.name)
    } catch { return out }
    for (const cid of names) {
      const dir = path.join(cfg.stateDir, cid)
      if (!fs.existsSync(path.join(dir, 'meta.json'))) continue
      try {
        const c = cache.get(cid) ?? Creature.open(dir, { halfLives: halfLivesFor(cfg, cid), waking: wakingFor(cfg, cid) })
        cache.set(cid, c)
        out.push(c)
      } catch { /* 坏目录跳过 */ }
    }
    return out.sort((a, b) => String(a.meta.bornAt).localeCompare(String(b.meta.bornAt)))
  }

  /** 住处冲突检查：返回已占用的那只鱼（或 null）。 */
  function conflictFor(creatureId, occ) {
    const others = listCreatures()
      .filter(c => c.meta.creatureId !== creatureId)
      .map(c => ({ creatureId: c.meta.creatureId, name: c.meta.name, occupancy: c.meta.occupancy }))
      .filter(c => c.occupancy)
    const hit = findConflict(occ, others)
    if (!hit) return null
    const other = others.find(o => o.creatureId === hit)
    return { creatureId: hit, name: other?.name ?? hit.slice(0, 8) }
  }

  /** 确定这条鱼住进某个住处；冲突则抛错（调用方转成 409）。 */
  function assign(creatureId, occ) {
    const c = get(creatureId)
    if (!c) throw new Error('找不到这条鱼')
    const conflict = conflictFor(creatureId, occ)
    if (conflict) {
      const err = new Error(`这个住处已经住着「${conflict.name}」了`)
      err.code = 'OCCUPIED'
      throw err
    }
    c.setOccupancy(occ)
    return c
  }

  function release(creatureId) {
    const c = get(creatureId)
    if (c) c.releaseOccupancy()
    return c
  }

  function get(creatureId) {
    const hit = cache.get(creatureId)
    if (hit) return hit
    const dir = path.join(cfg.stateDir, creatureId)
    if (!fs.existsSync(path.join(dir, 'meta.json'))) return null
    const c = Creature.open(dir, { halfLives: halfLivesFor(cfg, creatureId), waking: wakingFor(cfg, creatureId) })
    cache.set(creatureId, c)
    return c
  }

  /** 放生：把这条鱼连目录一起删掉（不可恢复；调用方负责确认）。 */
  function remove(creatureId) {
    const dir = path.join(cfg.stateDir, creatureId)
    if (!fs.existsSync(path.join(dir, 'meta.json'))) return false
    cache.delete(creatureId)
    fs.rmSync(dir, { recursive: true, force: true })
    return true
  }

  /** 出生：气质随机，不可指定。 */
  function randomTemperament() {
    const rng = mulberry32((Date.now() ^ (Math.random() * 2 ** 31)) >>> 0)
    return {
      ...DEFAULT_TEMPERAMENT,
      reactivity: 0.6 + rng() * 0.8,       // 0.6–1.4
      baselineArousal: 0.2 + rng() * 0.6,  // 0.2–0.8
      decayRate: 0.7 + rng() * 0.25,       // 0.70–0.95
      baselineValence: -0.2 + rng() * 0.4, // -0.2–+0.2
    }
  }

  /** 生一只新鱼：名字必填（可选住处）。 */
  function birth(name, occ = null) {
    const clean = String(name ?? '').trim()
    if (!clean) throw new Error('新鱼必须有名字')
    const cid = randomUUID()
    const meta = {
      schemaVersion: 1,
      creatureId: cid,
      name: clean,
      bornAt: new Date().toISOString(),
      timezone: cfg.timezone,
      model: { id: cfg.model, pinned: true },
      temperament: randomTemperament(),
      occupancy: occ,
    }
    Creature.create(path.join(cfg.stateDir, cid), meta)
    const c = Creature.open(path.join(cfg.stateDir, cid), { halfLives: halfLivesFor(cfg, cid), waking: wakingFor(cfg, cid) })
    cache.set(cid, c)
    return c
  }

  /**
   * 这个会话归哪只鱼（不凭空出生）。
   */
  function occupantOf(session) {
    noteScope(session.sessionId, session.workspace)
    const creatures = listCreatures()
    const hit = resolveOccupant(session, creatures.map(c => ({ creatureId: c.meta.creatureId, occupancy: c.meta.occupancy })))
    return hit ? get(hit.creatureId) : null
  }

  /**
   * 这个会话归哪只鱼。没有就是没有——不再自动出生（鱼必须由人起名创建）。
   */
  function resolve(session) {
    return occupantOf(session)
  }

  /**
   * 带 TTL 的 bias。工具约束在**每次工具调用**时都会读它，
   * 绝不能每次都同步 fold 整个日志（宿主主线程会被卡住）。
   * 找不到住户时不出生（工具调用不该造鱼），返回中性偏置。
   */
  function biasFor(sessionId, maxAgeMs = 5000, workspace) {
    // 先查缓存（会话级 key）：工具钩子每次调用都会进来，不能每次都扫目录/开个体
    const key = `${sessionId}|${workspace ?? ''}`
    const now = Date.now()
    const hit = biasCache.get(key)
    if (hit && now - hit.ts < maxAgeMs) return hit.bias
    const c = occupantOf({ sessionId, workspace })
    if (!c) return { verbosity: 0.5, thresholdRefuse: 0.5, thresholdVerify: 0.5, riskAppetite: 0.5, disclosure: 0.5, patience: 0.5 }
    const bias = c.bias()
    biasCache.set(key, { ts: now, bias })
    return bias
  }

  /** 会话有没有被这个插件管理 */
  function manages(sessionId) {
    if (cfg.sessionFilter.length === 0) return true
    return cfg.sessionFilter.includes(sessionId)
  }

  // 兼容：把旧的 bindings.json 迁移成个体自己的住处
  migrateLegacyBindings()

  return { dir: cfg.stateDir, creatureFor: (sid) => occupantOf({ sessionId: sid }), resolve, occupantOf, listCreatures, assign, release, birth, get, remove, conflictFor, biasFor, manages, scopes }
}
