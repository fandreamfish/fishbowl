/**
 * 记忆系统的配置：默认值、钳制、语义校验。
 * 单一来源——插件的 config.js 从这里拿默认值，避免两处各写一份。
 */

/** 主题标签的出厂词表（docs/MEMORY.md §7：10–15 个，留一个「其他」兜底）。 */
export const DEFAULT_TAGS = [
  '工作', '生活', '技术', '情感', '关系', '健康', '计划', '承诺',
  '设备', '娱乐', '金钱', '家人', '朋友', '学习', '其他',
]

export const MEMORY_DEFAULTS = {
  // N：每几轮落一条 turn 记录。1 = 零延迟。
  turnsPerRecord: 1,
  // 未整理多少轮后触发整理
  consolidateCap: 20,
  // 召回候选池
  recallPool: 20,
  // 注入预算（字符）
  injectBudget: 900,
  // 两层注入配比
  memoryRatio: 5,
  turnRatio: 3,
  // 平淡轮是否也写「她的总结」
  herSummaryOnPlainTurns: true,
  // 中性总结用哪个模型；空 = 跟评价器同一个
  neutralModel: '',
  // 主题标签词表
  tags: DEFAULT_TAGS,
  // 单写者：'warn' 检测并上报、'strict' 抢不到就抛、'off' 不管
  singleWriter: 'warn',
  // 是否注册 memory_search 工具
  searchTool: true,
  // 向量检索（L2）：默认关，等评测集说话（docs/MEMORY.md §4.3）
  embeddings: { enabled: false, model: '', baseUrl: '' },
}

function num(v, dflt, min, max) {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return dflt
  return Math.max(min, Math.min(max, n))
}

/** 补齐默认值并钳制越界值。 */
export function normalizeMemory(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  return {
    turnsPerRecord: Math.round(num(r.turnsPerRecord, MEMORY_DEFAULTS.turnsPerRecord, 1, 20)),
    consolidateCap: Math.round(num(r.consolidateCap, MEMORY_DEFAULTS.consolidateCap, 5, 100)),
    recallPool: Math.round(num(r.recallPool, MEMORY_DEFAULTS.recallPool, 5, 100)),
    injectBudget: Math.round(num(r.injectBudget, MEMORY_DEFAULTS.injectBudget, 300, 4000)),
    memoryRatio: Math.round(num(r.memoryRatio, MEMORY_DEFAULTS.memoryRatio, 0, 20)),
    turnRatio: Math.round(num(r.turnRatio, MEMORY_DEFAULTS.turnRatio, 0, 20)),
    herSummaryOnPlainTurns: r.herSummaryOnPlainTurns !== false,
    neutralModel: typeof r.neutralModel === 'string' ? r.neutralModel.slice(0, 60) : '',
    tags: Array.isArray(r.tags) && r.tags.length
      ? r.tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim()).slice(0, 40)
      : DEFAULT_TAGS.slice(),
    singleWriter: r.singleWriter === 'off' || r.singleWriter === 'strict' ? r.singleWriter : 'warn',
    searchTool: r.searchTool !== false,
    embeddings: {
      enabled: r.embeddings?.enabled === true,
      model: typeof r.embeddings?.model === 'string' ? r.embeddings.model.slice(0, 60) : '',
      baseUrl: typeof r.embeddings?.baseUrl === 'string' ? r.embeddings.baseUrl.slice(0, 200) : '',
    },
  }
}

/** 语义校验：结构上合法不等于说得通。返回错误列表，空 = 通过。 */
export function validateMemory(c) {
  const errs = []
  if (!(Number(c.consolidateCap) >= Number(c.turnsPerRecord))) errs.push('整理阈值不能小于「每几轮记录一次」')
  const inject = Number(c.memoryRatio || 0) + Number(c.turnRatio || 0)
  if (inject < 1) errs.push('合并层与最近 turn 的条数不能同时为 0')
  if (Number(c.recallPool || 0) < inject) errs.push(`召回池要 ≥ 注入条数（合并层 + 最近 turn = ${inject} 条）`)
  if (!Array.isArray(c.tags) || c.tags.length === 0) errs.push('主题标签词表不能为空')
  return errs
}
