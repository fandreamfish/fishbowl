/**
 * 检索（docs/MEMORY.md §4.3 L1）：中文二元组 + 英文词，BM25。
 * 没有 IDF 的命中数排序会让「我们」「这个」命中一切——所以必须先有倒排。
 */

const STOP = new Set([
  '我们', '你们', '他们', '她们', '这个', '那个', '什么', '怎么', '可以', '一个', '一下',
  '现在', '就是', '因为', '所以', '但是', '如果', '然后', '还是', '已经', '没有', '不是',
  '这么', '那么', '这样', '那样', '东西', '事情', '时候', '真的', '其实', '觉得', '知道',
  '有点', '应该', '可能', '一下', '一直', '这个', '那里', '这里', '自己', '一下',
])

export function tokenize(text: string, dropStop = true): string[] {
  const s = String(text ?? '').toLowerCase()
  const out: string[] = []
  const seen = new Set<string>()
  const push = (t: string) => {
    if (t.length < 2) return
    if (dropStop && STOP.has(t)) return
    if (seen.has(t)) return
    seen.add(t)
    out.push(t)
  }
  for (const m of s.matchAll(/[a-z0-9_]{2,}/g)) push(m[0])
  for (const seg of s.replace(/[^\u4e00-\u9fa5]/g, ' ').split(/\s+/)) {
    for (let i = 0; i + 2 <= seg.length; i++) push(seg.slice(i, i + 2))
  }
  if (out.length === 0 && dropStop) return tokenize(text, false)
  return out
}

export interface Doc {
  id: string
  text: string
  kind: 'memory' | 'turn'
  ref?: any
}

const K1 = 1.2
const B = 0.75

export class RecallIndex {
  docs: Doc[] = []
  private postings = new Map<string, Map<number, number>>()
  private lens: number[] = []
  private total = 0
  /** 已经索引到第几条（增量用） */
  private at = 0

  get size(): number {
    return this.docs.length
  }

  /** 增量补齐：只有新增的 doc 会被分词。 */
  sync(source: Doc[]): void {
    for (let i = this.at; i < source.length; i++) this.add(source[i])
    this.at = source.length
    if (this.docs.length > source.length) this.reset(source)
  }

  private reset(source: Doc[]): void {
    this.docs = []
    this.postings.clear()
    this.lens = []
    this.total = 0
    this.at = 0
    this.sync(source)
  }

  private add(doc: Doc): void {
    const idx = this.docs.length
    this.docs.push(doc)
    const toks = tokenize(doc.text)
    this.lens.push(toks.length)
    this.total += toks.length
    for (const t of toks) {
      let m = this.postings.get(t)
      if (!m) {
        m = new Map()
        this.postings.set(t, m)
      }
      m.set(idx, (m.get(idx) ?? 0) + 1)
    }
  }

  search(query: string, opts: { limit?: number; kind?: 'memory' | 'turn'; minScore?: number } = {}): { doc: Doc; score: number }[] {
    const toks = tokenize(query)
    if (!toks.length || !this.docs.length) return []
    const limit = opts.limit ?? 8
    const n = this.docs.length
    const avg = this.total / Math.max(1, n) || 1
    const scores = new Map<number, number>()

    for (const t of toks) {
      const m = this.postings.get(t)
      if (!m) continue
      const df = m.size
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5))
      for (const [idx, tf] of m) {
        if (opts.kind && this.docs[idx].kind !== opts.kind) continue
        const dl = this.lens[idx] || 1
        const s = idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * dl) / avg)))
        scores.set(idx, (scores.get(idx) ?? 0) + s)
      }
    }

    const out = []
    for (const [idx, score] of scores) {
      if (opts.minScore != null && score < opts.minScore) continue
      out.push({ doc: this.docs[idx], score })
    }
    out.sort((a, b) => b.score - a.score)
    return out.slice(0, limit)
  }
}
