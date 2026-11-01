/**
 * 整理（合并层）：把一批 turn 归纳成结论。
 * 触发靠水位线 + 上限；产出过四道闸；模型只填四个字段。
 */
import { MAX_EVIDENCE, MIN_EVIDENCE, clamp01, isKind, isSubject } from './events.ts'
import type { TurnRecord } from './records.ts'

export const MERGE_SYSTEM = [
  '你在整理一个人的长期记忆。给你一批「轮次记录」（每条含中性摘要、她当时的看法、当时情绪峰值、标签），',
  '把它们归纳成少数几条**结论**。',
  '只输出 JSON：',
  '{ "memories": [ { "kind": "fact|lesson|relation|self", "subject": "user|self|between|world",',
  '  "claim": "…", "attitude": "…", "tags": ["…"], "evidence": ["turnId"], "supersedes": "可选：旧记忆 id" } ] }',
  '规则：',
  '- claim 是第三人称、可独立读懂、不超过 80 字的一条**结论**，不是流水账。',
  '- attitude 可选：第一人称一句话、不超过 40 字，写「我」对这件事的态度。',
  '- evidence 必须用给定的 turn id；一条结论至少 {{MIN}} 条（关系类 3 条、且要跨会话或跨天；教训 1 条即可）。',
  '- 一条结论最多覆盖 {{MAX}} 轮；超过就拆成两条。',
  '- 最多 4 条结论；宁少勿多。',
  '- 没有可靠材料就输出空数组，禁止编造；不要输出批里没有证据的东西。',
  '- 如果新结论推翻了你已经有的某条记忆，用它并填 supersedes（旧记忆 id）。',
  'kind 的含义：fact=关于他/世界的事实或偏好；lesson=「当 X 时先做 Y」的教训；relation=我们之间的关系；self=我是什么样的人。',
].join('\n')

export function buildMergeUser(turns: TurnRecord[], existing: { id: string; claim: string }[], tags: string[]) {
  const lines = turns.map((t) => {
    const her = t.her.length ? t.her[t.her.length - 1].text : '（无）'
    const peak = t.affectPeak ? `情绪 效价${Number(t.affectPeak.valence).toFixed(2)}/唤醒${Number(t.affectPeak.arousal).toFixed(2)}` : ''
    return `- [${t.id}] ${t.neutral || '（无中性摘要）'}\n  她的看法：${her}\n  ${peak}${t.tags.length ? ' 标签:' + t.tags.join(',') : ''}`
  })
  const known = existing.length
    ? '你已经记住的（不要重复；要推翻就用 supersedes）：\n' + existing.map((m) => `- [${m.id}] ${m.claim}`).join('\n')
    : '你还没有任何结论。'
  return `${known}\n\n标签词表：${tags.join(' / ')}\n\n这一批轮次：\n${lines.join('\n')}`
}

/** 解析 + 结构性收敛。语义门槛在 gateMemories 里。 */
export function parseMerge(raw: string): any[] {
  let j = {}
  const m = String(raw ?? '').match(/\{[\s\S]*\}/)
  if (m) {
    try { j = JSON.parse(m[0]) } catch { j = {} }
  }
  const list = Array.isArray(j.memories) ? j.memories : []
  return list.slice(0, 6).map((x) => ({
    kind: isKind(x?.kind) ? x.kind : 'fact',
    subject: isSubject(x?.subject) ? x.subject : 'user',
    claim: typeof x?.claim === 'string' ? x.claim.trim().slice(0, 160) : '',
    attitude: typeof x?.attitude === 'string' ? x.attitude.trim().slice(0, 80) : null,
    trigger: typeof x?.trigger === 'string' ? x.trigger.trim().slice(0, 80) : undefined,
    action: typeof x?.action === 'string' ? x.action.trim().slice(0, 120) : undefined,
    tags: Array.isArray(x?.tags) ? x.tags.filter((t) => typeof t === 'string').slice(0, 3) : [],
    evidence: Array.isArray(x?.evidence) ? x.evidence.filter((e) => typeof e === 'string') : [],
    supersedes: typeof x?.supersedes === 'string' ? x.supersedes : null,
    confidence: Number.isFinite(Number(x?.confidence)) ? clamp01(Number(x.confidence)) : null,
  }))
}

export interface GateResult {
  accepted: any[]
  rejected: { claim: string; why: string }[]
}

/**
 * 四道闸（docs/MEMORY.md §2.4）：
 * 证据必须是本批真实 turn、去重后够门槛、不超过上限、关系类要跨会话或跨天。
 */
export function gateMemories(candidates: any[], batch: TurnRecord[], tagList: string[]): GateResult {
  const byId = new Map(batch.map((t) => [t.id, t]))
  const accepted = []
  const rejected = []

  for (const c of candidates) {
    const claim = String(c.claim || (c.trigger ? `${c.trigger} → ${c.action}` : '')).trim()
    if (!claim) { rejected.push({ claim: '(空)', why: '没有结论' }); continue }
    const uniq = [...new Set(c.evidence || [])].filter((id) => byId.has(id))
    if (uniq.length !== (c.evidence || []).length) {
      rejected.push({ claim, why: '证据里有本批不存在的 turn' })
      continue
    }
    const min = MIN_EVIDENCE[c.kind] ?? 2
    if (uniq.length < min) { rejected.push({ claim, why: `证据不足（${uniq.length}/${min}）` }); continue }
    if (uniq.length > MAX_EVIDENCE) { rejected.push({ claim, why: `证据过多（${uniq.length}>${MAX_EVIDENCE}）` }); continue }

    const turns = uniq.map((id) => byId.get(id))
    const sessions = new Set(turns.map((t) => (t.scope ? `${t.scope.kind}:${t.scope.id}` : '')))
    const days = new Set(turns.map((t) => Math.floor(t.ts / 86_400_000)))
    if (c.kind === 'relation' && sessions.size <= 1 && days.size <= 1) {
      rejected.push({ claim, why: '关系类需要跨会话或跨天的证据' })
      continue
    }

    const tags = (c.tags || []).filter((t) => tagList.includes(t)).slice(0, 3)
    const n = uniq.length
    const byCount = Math.min(1, 0.5 + 0.15 * (n - 1))
    accepted.push({
      kind: c.kind,
      subject: c.subject,
      claim,
      attitude: c.attitude || null,
      trigger: c.trigger,
      action: c.action,
      tags,
      evidence: uniq,
      confidence: c.confidence == null ? byCount : clamp01((c.confidence + byCount) / 2),
      supersedes: c.supersedes || null,
      evidenceStats: { turns: n, sessions: sessions.size, days: days.size },
    })
  }
  return { accepted, rejected }
}

/** 取 n 元组：中文按字，英文/数字按词。 */
function grams(text: string, n: number): Set<string> {
  const s = String(text ?? '').toLowerCase()
  const out = new Set<string>()
  for (const m of s.matchAll(/[a-z0-9_]{2,}/g)) out.add(m[0])
  for (const seg of s.replace(/[^\u4e00-\u9fa5]/g, ' ').split(/\s+/)) {
    for (let i = 0; i + n <= seg.length; i++) out.add(seg.slice(i, i + n))
  }
  return out
}

/** Dice 系数（比 Jaccard 对改写更宽容）。 */
function dice(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter += 1
  return (2 * inter) / (a.size + b.size)
}

/**
 * 字面相似度（bigram 的 Dice）。
 * 只做「同一句结论换了几个字」的去重，不做语义判断——同义词改写靠模型自己别重复，
 * 真正的语义检索是 docs/MEMORY.md §4.3 的 L2，等评测集跑出来再说。
 */
export function similarity(a: string, b: string): number {
  return dice(grams(a, 2), grams(b, 2))
}

/**
 * 同一件事的结论不再落盘：相似度 ≥ 0.6 视为重复，交给调用方做强化。
 * 返回要新建的、以及被判定为重复的。
 */
export function dedupeAgainst(candidates: any[], existing: { id: string; claim: string; kind: string }[], threshold = 0.6) {
  const fresh = []
  const dup = []
  for (const c of candidates) {
    const hit = existing.find((m) => m.kind === c.kind && similarity(m.claim, c.claim) >= threshold)
    if (hit) dup.push({ candidate: c, hit })
    else fresh.push(c)
  }
  return { fresh, dup }
}
