/**
 * memory_search 工具：她自己翻记忆（docs/MEMORY.md §7.4「查阅」通道）。
 *
 * 设计约束：
 *   - 零依赖：不 import @deepseek-ai/dsh-tools，直接用注册表认的 JSON Schema 形状；
 *   - 只在这一层认识宿主：会话从 exec.agent 拿，其余交给 binding / memory；
 *   - 返回纯文本：她说得出口的东西，不是 JSON。
 */
import { workspaceOf } from '../lib/extract.js'
import { dialogOnly } from '../../../src/core/signals.ts'
import { configFor } from '../lib/fishcfg.js'

function fmtTime(ts) {
  try {
    const d = new Date(Number(ts))
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  } catch {
    return '—'
  }
}

/** 一条命中 → 一行（记忆给结论，轮次给原文片段）。 */
export function formatHit(hit, i) {
  const r = hit.record || {}
  if (hit.kind === 'memory') {
    const kind = { fact: '事实', lesson: '教训', relation: '关系', self: '自我' }[r.kind] || r.kind || '记忆'
    const ev = Array.isArray(r.evidence) ? r.evidence.length : 0
    const att = r.attitude ? `（${r.attitude}）` : ''
    return `${i + 1}. [${kind}·${ev} 轮] ${r.claim || hit.text}${att}`
  }
  const when = fmtTime(r.ts)
  const neutral = String(r.neutral || '').trim()
  const raw = dialogOnly(r.note ? String(r.note) : '').replace(/\s+/g, ' ').trim()
  const tail = raw && raw !== neutral ? `\n   原话：${raw.slice(0, 160)}` : ''
  return `${i + 1}. [对话 ${when}] ${neutral || raw.slice(0, 100)}${tail}`
}

/**
 * @param binding 住处解析
 * @param cfg 配置
 * @param memoryFor (creature) => Memory
 */
export function createMemoryTool(binding, cfg, memoryFor) {
  return {
    name: 'memory_search',
    description:
      '在自己的记忆里翻找。想不起某件事、用户问「你还记得…」、或需要以前的细节时用它。'
      + '返回相关的结论和过去的对话片段；找不到就如实说找不到。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '要找的内容：人名、事由、物品、感受都可以' },
        limit: { type: 'integer', minimum: 1, maximum: 10, description: '最多几条，默认 5' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      // 工具是全局注册的，但只有本会话（住着一条鱼）才翻得到东西
      const session = exec?.agent?.session
      const sid = session?.id
      if (!sid) return '（这一轮拿不到会话，翻不了记忆）'
      const creature = binding.resolve({ sessionId: sid, workspace: workspaceOf(session) })
    if (creature && configFor(cfg, creature).capabilities?.memorySearch === false) return '我现在不翻记忆。'
      if (!creature) return '（这条会话里没有鱼住，没有记忆可翻）'
      const q = String(args?.query ?? '').trim()
      if (!q) return '要翻什么？给我一个词。'
      const limit = Math.max(1, Math.min(10, Number(args?.limit) || 5))
      const mem = memoryFor(creature)
      let hits = []
      try {
        hits = await mem.searchHybrid(q, { limit })
      } catch {
        hits = mem.search(q, { limit })
      }
      if (!hits.length) return `关于「${q}」，我没翻到什么。`
      // 真用到了：记一笔，重量会因此上升
      try {
        const top = hits.slice(0, 3)
        for (const h of top) if (h.kind === 'memory') mem.recordHit('', h.id, 'used')
      } catch { /* 记不上不影响回答 */ }
      return [`关于「${q}」，翻了 ${hits.length} 条：`, ...hits.map(formatHit)].join('\n')
    },
  }
}
