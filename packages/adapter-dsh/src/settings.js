/**
 * 设置页的配置读写：ui-config.json 的合并、保存、校验。
 * 与 HTTP 无关，resource 与入口都能直接用。
 */
import fs from 'node:fs'
import path from 'node:path'
import { validateMemory } from '../../memory/src/config.ts'
import { pickCommentConfig, pickRoutineConfig } from '../../app/src/cfgkeys.js'
import { normalizeBrowseConfig } from '../../bilibili/src/browse.ts'

/** 合并 UI 保存的配置（ui-config.json）到配置对象。 */
export function mergeUiConfig(raw, ui) {
  if (!ui || typeof ui !== 'object') return raw
  const out = { ...raw }
  if (typeof ui.growth === 'number' && Number.isFinite(ui.growth)) out.growth = ui.growth
  if (ui.seed && typeof ui.seed === 'object') out.seed = { name: String(ui.seed.name ?? ''), background: String(ui.seed.background ?? '') }
  if (ui.memory && typeof ui.memory === 'object') out.memory = { ...(raw.memory || {}), ...ui.memory }
  if (ui.wake && typeof ui.wake === 'object') out.wake = pickRoutineConfig({ wake: ui.wake }).wake
  if (ui.contact && typeof ui.contact === 'object') out.contact = pickRoutineConfig({ contact: ui.contact }).contact
  if (ui.selfTime && typeof ui.selfTime === 'object') out.selfTime = pickRoutineConfig({ selfTime: ui.selfTime }).selfTime
  if (ui.browse && typeof ui.browse === 'object') out.browse = normalizeBrowseConfig(ui.browse)
  if (ui.comment && typeof ui.comment === 'object') out.comment = pickCommentConfig(ui.comment)
  if (ui.relation && typeof ui.relation === 'object' && typeof ui.relation.kind === 'string') {
    out.relation = { kind: ['companion', 'friend'].includes(ui.relation.kind) ? ui.relation.kind : 'companion' }
  }
  return out
}

export function validateMemoryConfig(c) {
  return validateMemory(c)
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
