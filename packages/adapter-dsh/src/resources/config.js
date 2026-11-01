/** 全局配置路由：记忆配置、旧版 /config、/state。 */
import { normalizeConfig } from '../../../app/src/index.js'
import { pickMemoryConfig, pickRoutineConfig } from '../../../app/src/index.js'
import { mergeUiConfig, saveUiConfig, seedChanged, validateMemoryConfig } from '../settings.js'

export async function handleConfig({ cfg, stateDir, opts, views, send, readBody }, req, res, parts, sub) {
  // —— 记忆配置（全局；改的是她的记忆行为，不是单个会话） ——
  if (parts[0] === 'memory' && parts[1] === 'config') {
    if (req.method === 'GET') { send(res, { ok: true, config: cfg.memory }); return true }
    if (req.method === 'POST') {
      const body = JSON.parse(await readBody(req) || '{}')
      const merged = { ...cfg.memory, ...pickMemoryConfig(body) }
      const errors = validateMemoryConfig(merged)
      if (errors.length) { send(res, { ok: false, error: errors.join('；') }, 400); return true }
      cfg.memory = normalizeConfig({ ...cfg, memory: merged }).memory
      saveUiConfig(stateDir, { memory: cfg.memory })
      send(res, { ok: true, config: cfg.memory })
      return true
    }
  }

  // —— 兼容旧路径 ——
  if (sub === '/state' && req.method === 'GET') { send(res, views.stateView()); return true }
  if (sub === '/config' && req.method === 'GET') {
    send(res, { growth: cfg.growth, seed: cfg.seed ?? null, memory: cfg.memory, wake: cfg.wake, contact: cfg.contact, selfTime: cfg.selfTime, browse: cfg.browse, comment: cfg.comment, relation: cfg.relation })
    return true
  }
  if (sub === '/config' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req) || '{}')
    const ui = mergeUiConfig({}, body)
    // 公理 A1：她出生后来历只读——历史会被铭记，只能说服，不能修改
    if (views.stateView().born && seedChanged(cfg.seed, ui.seed)) {
      send(res, { ok: false, error: '她已经出生了，来历不能再改（历史会被铭记，只能说服不能修改）' }, 409)
      return true
    }
    const routine = pickRoutineConfig(body)
    saveUiConfig(stateDir, {
      growth: ui.growth,
      seed: ui.seed ?? null,
      wake: { ...cfg.wake, ...(routine.wake ?? {}) },
      contact: { ...cfg.contact, ...(routine.contact ?? {}) },
      selfTime: { ...cfg.selfTime, ...(routine.selfTime ?? {}) },
      ...(ui.browse ? { browse: ui.browse } : {}),
      ...(ui.comment ? { comment: { ...cfg.comment, ...ui.comment } } : {}),
      relation: ui.relation ?? cfg.relation,
    })
    if (typeof ui.growth === 'number') cfg.growth = ui.growth
    if (ui.seed && !views.stateView().born) cfg.seed = ui.seed
    if (routine.wake) cfg.wake = { ...cfg.wake, ...routine.wake }
    if (routine.contact) cfg.contact = { ...cfg.contact, ...routine.contact }
    if (routine.selfTime) cfg.selfTime = { ...cfg.selfTime, ...routine.selfTime }
    if (ui.browse) cfg.browse = ui.browse
    if (ui.comment) cfg.comment = { ...cfg.comment, ...ui.comment }
    if (ui.relation) cfg.relation = ui.relation
    if (routine.wake || routine.selfTime) { try { opts?.restartWake?.() } catch { /* 忽略 */ } }
    send(res, { ok: true, growth: cfg.growth, seed: cfg.seed ?? null, memory: cfg.memory, wake: cfg.wake, contact: cfg.contact, selfTime: cfg.selfTime, browse: cfg.browse, comment: cfg.comment, relation: cfg.relation })
    return true
  }
  return false
}
