/**
 * 巩固：把情节压成语义与教训。
 * 触发与解析是纯函数；LLM 调用在插件侧（lib/llm.js）。
 * 设计原则：巩固产物必须落盘（重算会得到不同的东西），情绪才是重算的。
 */

/** 触发规则：证据量达到阈值（g 越大越频繁）。 */
export function shouldConsolidate(opts: { episodesSince: number; salienceSince: number; g: number }): boolean {
  const g = Math.max(opts.g, 0.1)
  return opts.episodesSince >= 5 / g || opts.salienceSince >= 0.6 / g
}

export const CONSOLIDATION_SYSTEM_PROMPT = [
  '你是记忆巩固器。给你一个 AI 与用户最近的对话转录（user: / assistant: 格式，行号从 1 开始），',
  '归纳"值得长期记住的东西"。只输出 JSON：',
  '{',
  '  "semantics": [ {"claim": "…", "evidence": ["1","3"], "confidence": 0.8} ],',
  '  "procedures": [ {"trigger": "…", "action": "…", "evidence": ["2"], "confidence": 0.7} ]',
  '}',
  '规则：',
  '- claim 是关于"他（用户）"、"我（AI）"或"我们之间"的稳定事实、偏好或期待，不是流水账。',
  '- evidence 用行号指证；一条 claim 至少 2 个证据行，除非单一事件极其显著。',
  '- procedure 是"当 X 时，先做 Y"的可执行教训。',
  '- 没有可靠材料就输出空数组，禁止编造。总数 semantics ≤ 3，procedures ≤ 2。',
  '- 不要输出 JSON 以外的任何内容。',
].join('\n')

export interface ParsedSemantic { claim: string; evidence: string[]; confidence: number }
export interface ParsedProcedure { trigger: string; action: string; evidence: string[]; confidence: number }

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

/** 防御性解析：输出永远可用，坏输入得到空数组。 */
export function parseConsolidation(text: string): { semantics: ParsedSemantic[]; procedures: ParsedProcedure[] } {
  try {
    const json = JSON.parse((text.match(/\{[\s\S]*\}/) || ['{}'])[0])
    const clean = (x: unknown): string[] =>
      (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [])

    const semantics = (Array.isArray(json.semantics) ? json.semantics : [])
      .slice(0, 3)
      .filter((s) => typeof s?.claim === 'string' && s.claim.trim().length > 0)
      .map((s) => ({
        claim: s.claim.trim(),
        evidence: clean(s.evidence).slice(0, 8),
        confidence: clamp01(Number(s.confidence) || 0.5),
      }))

    const procedures = (Array.isArray(json.procedures) ? json.procedures : [])
      .slice(0, 2)
      .filter((p) => typeof p?.trigger === 'string' && typeof p?.action === 'string')
      .map((p) => ({
        trigger: p.trigger.trim(),
        action: p.action.trim(),
        evidence: clean(p.evidence).slice(0, 8),
        confidence: clamp01(Number(p.confidence) || 0.5),
      }))

    return { semantics, procedures }
  } catch {
    return { semantics: [], procedures: [] }
  }
}
