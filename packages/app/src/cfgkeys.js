/**
 * 配置键的校验：只接受认识的键。
 * 作息、评论、记忆的校验归各自的能力包；这里只做聚合与转出，兼容旧调用方。
 */
export { pickRoutineConfig } from '../../schedule/src/index.ts'
export { pickCommentConfig } from '../../bilibili/src/index.js'

/** 只接受认识的记忆配置键（防前端塞垃圾）。 */
export function pickMemoryConfig(x) {
  const out = {}
  for (const k of ['turnsPerRecord', 'consolidateCap', 'recallPool', 'injectBudget', 'memoryRatio', 'turnRatio']) {
    if (typeof x?.[k] === 'number' && Number.isFinite(x[k])) out[k] = x[k]
  }
  if (typeof x?.enabled === 'boolean') out.enabled = x.enabled
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
