/**
 * 向量检索（docs/MEMORY.md §4.3 的 L2）——**默认关闭**。
 *
 * 为什么要关着：§4.3 说得很清楚，L2 的门槛是评测集跑出来「BM25 不够用」。
 * 这里把管道建好（可插、可降级、可测），但开关默认 false，
 * 等 `scripts/memory-eval.ts` 用真实标注跑出结论再决定。
 */
import fs from 'node:fs'
import path from 'node:path'

export interface Embedder {
  id: string
  embed(texts: string[]): Promise<number[][]>
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  if (!n) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** OpenAI 兼容的 /embeddings。失败就抛，由调用方降级回 BM25。 */
export function createHttpEmbedder(opts: { baseUrl: string; apiKey?: string; model: string }): Embedder {
  const base = String(opts.baseUrl || '').replace(/\/+$/, '')
  return {
    id: `http:${opts.model}`,
    async embed(texts: string[]): Promise<number[][]> {
      if (!texts.length) return []
      const res = await fetch(`${base}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: opts.model, input: texts }),
        signal: AbortSignal.timeout(20_000),
      })
      if (!res.ok) throw new Error(`http ${res.status}`)
      const data: any = await res.json()
      const list = Array.isArray(data?.data) ? data.data : []
      return list.map((d: any) => (Array.isArray(d?.embedding) ? d.embedding : [])).filter((v: any) => v.length > 0)
    },
  }
}

/**
 * 向量库：append-only 的 ndjson，一行一条 {id, model, v}。
 * 模型换掉 → 旧向量不参与检索（维度/语义都可能不同）。
 */
export class VectorStore {
  readonly file: string
  private map = new Map<string, { model: string; v: number[] }>()
  private loaded = false

  constructor(dir: string, file = 'vectors.ndjson') {
    this.file = path.join(dir, file)
  }

  private load(): void {
    if (this.loaded) return
    this.loaded = true
    let text = ''
    try {
      text = fs.readFileSync(this.file, 'utf8')
    } catch {
      return
    }
    for (const line of text.split('\n')) {
      const s = line.trim()
      if (!s) continue
      try {
        const o = JSON.parse(s)
        if (o?.id && Array.isArray(o.v)) this.map.set(String(o.id), { model: String(o.model || ''), v: o.v })
      } catch {
        // 坏行跳过
      }
    }
  }

  has(id: string, model: string): boolean {
    this.load()
    const hit = this.map.get(id)
    return !!hit && hit.model === model
  }

  put(id: string, model: string, v: number[]): void {
    this.load()
    this.map.set(id, { model, v })
    try {
      fs.appendFileSync(this.file, JSON.stringify({ id, model, v }) + '\n')
    } catch {
      // 写不进去只影响下次启动的冷缓存
    }
  }

  search(qv: number[], opts: { limit?: number; model?: string } = {}): { id: string; score: number }[] {
    this.load()
    const out: { id: string; score: number }[] = []
    for (const [id, item] of this.map) {
      if (opts.model && item.model !== opts.model) continue
      out.push({ id, score: cosine(qv, item.v) })
    }
    out.sort((a, b) => b.score - a.score)
    return out.slice(0, opts.limit ?? 8)
  }

  get size(): number {
    this.load()
    return this.map.size
  }
}

/** Reciprocal Rank Fusion：两路排序合成一路，不需要调分数尺度。 */
export function rrf<T extends { id: string }>(lists: T[][], k = 60): (T & { fused: number })[] {
  const score = new Map<string, { item: T; s: number }>()
  for (const list of lists) {
    list.forEach((item, i) => {
      if (!item?.id) return
      const cur = score.get(item.id) || { item, s: 0 }
      cur.s += 1 / (k + i + 1)
      score.set(item.id, cur)
    })
  }
  return [...score.values()].sort((a, b) => b.s - a.s).map((x) => ({ ...x.item, fused: x.s }))
}
