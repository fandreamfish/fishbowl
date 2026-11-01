/**
 * 每条鱼独立的配置。
 *
 * 默认值来自插件配置（cordis.patch.yml），每条鱼的覆盖写在 `creatures/<id>/config.json`。
 * 读的时候合并：默认 ← 这条鱼的文件。所以改 A 的作息不会动到 B。
 *
 * 哪些能按鱼分：成长率、作息（清醒/联系/自处）、记忆、上网、评论、关系原型。
 * 哪些只能是插件级：模型与密钥、时区、状态目录（它们不是"她的偏好"）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { normalizeMemory } from '../../memory/src/index.ts'
import { normalizeBrowseConfig } from '../../bilibili/src/index.js'
import { pickCommentConfig, pickMemoryConfig, pickRoutineConfig } from './cfgkeys.js'

const cached = new Map() // file -> { mtimeMs, value }

export function fishConfigPath(stateDir, creatureId) {
  return path.join(stateDir, creatureId, 'config.json')
}

/** 这条鱼有没有自己的配置文件。 */
export function hasFishConfig(stateDir, creatureId) {
  return fs.existsSync(fishConfigPath(stateDir, creatureId))
}

/** 读这条鱼的覆盖（没有就返回 null）。缓存按 mtime 失效。 */
export function readFishConfig(stateDir, creatureId) {
  const file = fishConfigPath(stateDir, creatureId)
  try {
    const st = fs.statSync(file)
    const hit = cached.get(file)
    if (hit && hit.mtimeMs === st.mtimeMs) return hit.value
    const value = JSON.parse(fs.readFileSync(file, 'utf8'))
    const clean = value && typeof value === 'object' ? value : null
    cached.set(file, { mtimeMs: st.mtimeMs, value: clean })
    return clean
  } catch {
    return null
  }
}

/** 校验一条鱼能改的键（不认识的值直接丢）。 */
export function pickFishPatch(body) {
  if (!body || typeof body !== 'object') return {}
  const out = {}
  if (typeof body.growth === 'number' && Number.isFinite(body.growth)) out.growth = Math.min(5, Math.max(0.2, body.growth))
  const routine = pickRoutineConfig(body)
  if (routine.wake) out.wake = routine.wake
  if (routine.contact) out.contact = routine.contact
  if (routine.selfTime) out.selfTime = routine.selfTime
  const memory = pickMemoryConfig(body.memory)
  if (Object.keys(memory).length) out.memory = memory
  if (body.seed && typeof body.seed === 'object') {
    out.seed = {
      name: String(body.seed.name ?? '').slice(0, 40),
      background: String(body.seed.background ?? '').slice(0, 800),
    }
  }
  if (body.browse && typeof body.browse === 'object') out.browse = normalizeBrowseConfig(body.browse)
  const comment = pickCommentConfig(body.comment)
  if (comment && Object.keys(comment).length) out.comment = comment
  if (body.capabilities && typeof body.capabilities === 'object') {
    const on = (v, dflt) => (v === undefined ? dflt : v !== false)
    out.capabilities = {
      browse: on(body.capabilities.browse, true),
    }
    // 能力 = 总开关；同步到旧的行为字段，运行时逻辑继续认它们
    out.browse = { ...(out.browse || {}), enabled: out.capabilities.browse }
  }
  if (body.diary && typeof body.diary === 'object') {
    const hm = (v, dflt) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v ?? '')) ? String(v) : dflt)
    out.diary = {
      enabled: body.diary.enabled !== false,
      start: hm(body.diary.start, '21:30'),
      end: hm(body.diary.end, '23:59'),
      catchUp: body.diary.catchUp !== false,
    }
  }
  if (body.affect && typeof body.affect === 'object') {
    const days = (v, dflt) => (Number.isFinite(Number(v)) ? Math.min(60, Math.max(0.1, Number(v))) : dflt)
    out.affect = {
      guiltDays: days(body.affect.guiltDays, 3),
      longingDays: days(body.affect.longingDays, 2),
      negativeDays: days(body.affect.negativeDays ?? body.affect.namedDays, 2),
    }
  }
  if (body.relation && typeof body.relation === 'object' && ['companion', 'friend'].includes(body.relation.kind)) {
    out.relation = { kind: body.relation.kind }
  }
  return out
}

/** 写这条鱼的覆盖（合并已有；只接受认识的键）。 */
/** 一层深合并：section 内的子键不因为只改一个字段就整段丢掉。 */
function mergeOneLevel(base, patch) {
  const out = { ...(base || {}) }
  for (const [k, v] of Object.entries(patch || {})) {
    const cur = out[k]
    if (v && typeof v === "object" && !Array.isArray(v) && cur && typeof cur === "object" && !Array.isArray(cur)) {
      out[k] = { ...cur, ...v }
    } else out[k] = v
  }
  return out
}
export function writeFishConfig(stateDir, creatureId, patch, cfg = null) {
  const file = fishConfigPath(stateDir, creatureId)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  let cur = {}
  try { cur = JSON.parse(fs.readFileSync(file, 'utf8')) || {} } catch { /* 首次 */ }
  const clean = pickFishPatch(patch)
  // 有 cfg 时以完整模板打底：即使旧文件缺子键，也会在写入时补齐
  const base = cfg ? fullFishConfig(cfg) : {}
  const next = mergeOneLevel(mergeOneLevel(base, cur), clean)
  fs.writeFileSync(file, JSON.stringify(next, null, 2))
  cached.delete(file)
  return next
}

/**
 * 这条鱼生效的配置：默认值 + 自己的覆盖。
 * 注意只返回浅拷贝，嵌套对象按需合并。
 */
export function configFor(cfg, creature) {
  const cid = creature?.meta?.creatureId
  if (!cid) return cfg
  const over = readFishConfig(cfg.stateDir, cid)
  if (!over) return cfg
  const out = { ...cfg }
  if (typeof over.growth === 'number') out.growth = over.growth
  if (over.seed && typeof over.seed === 'object') out.seed = over.seed
  if (over.wake) out.wake = { ...cfg.wake, ...over.wake }
  if (over.contact) out.contact = { ...cfg.contact, ...over.contact }
  if (over.selfTime) out.selfTime = { ...cfg.selfTime, ...over.selfTime }
  if (over.browse) out.browse = { ...cfg.browse, ...over.browse }
  if (over.comment) out.comment = { ...cfg.comment, ...over.comment }
  if (over.relation) out.relation = { ...cfg.relation, ...over.relation }
  if (over.diary) out.diary = { ...cfg.diary, ...over.diary }
  if (over.capabilities) out.capabilities = { ...cfg.capabilities, ...over.capabilities }
  if (over.affect) out.affect = { ...cfg.affect, ...over.affect }
  if (over.memory) out.memory = normalizeMemory({ ...cfg.memory, ...over.memory })
  return out
}

/** 传给设置页的样子（这条鱼自己的值优先，缺的用默认）。 */
export function fishConfigView(cfg, creature) {
  const f = configFor(cfg, creature)
  return {
    growth: f.growth,
    seed: f.seed ?? null,
    wake: f.wake,
    contact: f.contact,
    selfTime: f.selfTime,
    memory: f.memory,
    affect: f.affect,
    diary: f.diary,
    capabilities: f.capabilities,
    browse: f.browse,
    comment: f.comment,
    relation: f.relation,
  }
}

/**
 * 迁移：以前配置是全家的（ui-config.json）。给还没有自己配置文件的鱼写一份，
 * 之后各改各的互不影响。返回迁移了几条。
 */
export function migrateFishConfigs(cfg, creatures, legacy = null) {
  if (!legacy || typeof legacy !== 'object') return 0
  let n = 0
  for (const c of creatures ?? []) {
    const cid = c?.meta?.creatureId
    if (!cid) continue
    const file = fishConfigPath(cfg.stateDir, cid)
    if (fs.existsSync(file)) continue
    const patch = pickFishPatch({
      growth: legacy.growth,
      wake: legacy.wake,
      contact: legacy.contact,
      selfTime: legacy.selfTime,
      memory: legacy.memory,
      browse: legacy.browse,
      comment: legacy.comment,
      relation: legacy.relation,
    })
    if (Object.keys(patch).length === 0) continue
    writeFishConfig(cfg.stateDir, cid, patch, cfg)
    n++
  }
  return n
}

/** 这条鱼的半衰期（给 Creature.open 用）。 */
export function halfLivesFor(cfg, creatureId) {
  const over = readFishConfig(cfg.stateDir, creatureId)
  const a = { ...(cfg.affect || {}), ...(over?.affect || {}) }
  const days = (v, dflt) => (Number.isFinite(Number(v)) ? Math.min(60, Math.max(0.1, Number(v))) : dflt)
  return { guilt: days(a.guiltDays, 3), longing: days(a.longingDays, 2), negative: days(a.negativeDays ?? a.namedDays, 2) }
}
/** 这条鱼的清醒时段（想念只在这段时间里涨）。 */
export function wakingFor(cfg, creatureId) {
  const over = readFishConfig(cfg.stateDir, creatureId)
  const w = over?.wake?.activeWindow || cfg.wake?.activeWindow
  const window = Array.isArray(w) && w.length === 2 ? [String(w[0]), String(w[1])] : null
  if (!window) return null
  return { window, timezone: cfg.timezone || 'Asia/Shanghai' }
}

/**
 * 一条鱼的完整配置快照（不含密钥/路径这类机器级设置）。
 * 创建时写一份到 config.json，之后这条鱼的所有配置读写都以它为准。
 */
export function fullFishConfig(cfg = {}) {
  const cp = (x) => (x && typeof x === "object" ? JSON.parse(JSON.stringify(x)) : x)
  return {
    growth: cfg.growth,
    seed: cp(cfg.seed ?? null),
    wake: cp(cfg.wake),
    contact: cp(cfg.contact),
    selfTime: cp(cfg.selfTime),
    memory: cp(cfg.memory),
    browse: cp(cfg.browse),
    comment: cp(cfg.comment),
    capabilities: cp(cfg.capabilities ?? { browse: true }),
    diary: cp(cfg.diary),
    affect: cp(cfg.affect),
    relation: cp(cfg.relation),
  }
}

/** 保证这条鱼有一份完整 config.json：没有就复制模板，有就补齐缺的顶层键（已有的优先）。 */
export function ensureFullFishConfig(stateDir, creature, cfg) {
  const cid = creature?.meta?.creatureId
  if (!cid) return null
  const file = fishConfigPath(stateDir, cid)
  let cur = {}
  try { cur = JSON.parse(fs.readFileSync(file, "utf8")) || {} } catch { cur = {} }
  const next = mergeOneLevel(fullFishConfig(cfg), cur)
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(next, null, 2), "utf8")
    cached.delete(file)
    return next
  } catch { return null }
}
