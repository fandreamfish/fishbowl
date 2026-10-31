/**
 * 记忆检索评测（docs/MEMORY.md §4.3）：决定要不要上 embedding 的唯一依据。
 *
 * 用法：
 *   node scripts/memory-eval.ts --fish <个体目录> --cases cases.json [--hybrid] [--k 5]
 *
 * cases.json： [{ "query": "他生日是哪天", "expect": ["生日", "<记忆 id>"] }, …]
 *   —— expect 里任意一项命中（子串或 id）就算召回。
 *
 * 不给 --cases 时，会用现有合并记忆自动生成一份「自召回」用例：
 * 从 claim 里取一段有辨识度的子串当查询，期望它自己被召回来。
 * 这只验证「索引通不通」，不验证「语义像不像」——真正的评测还是要人工标注。
 */
import fs from 'node:fs'
import path from 'node:path'
import { Memory } from '../packages/memory/src/memory.ts'

function arg(name: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf('--' + name)
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1]
  return dflt
}
const has = (name: string) => process.argv.includes('--' + name)

const fishDir = arg('fish')
if (!fishDir) {
  console.error('用法: node scripts/memory-eval.ts --fish <个体目录> [--cases cases.json] [--hybrid] [--k 5]')
  process.exit(2)
}
if (!fs.existsSync(fishDir)) {
  console.error(`找不到个体目录：${fishDir}`)
  process.exit(2)
}

const K = Math.max(1, Number(arg('k', '5')))
const useHybrid = has('hybrid')
const mem = new Memory({ dir: fishDir })

interface Case { query: string; expect: string[] }

function autoCases(): Case[] {
  const view = mem.view()
  const out: Case[] = []
  for (const m of view.memories) {
    if (m.status !== 'active') continue
    const claim = m.claim.replace(/^用户|^他/, '').trim()
    if (claim.length < 6) continue
    const q = claim.slice(0, Math.min(10, Math.max(4, Math.floor(claim.length / 2))))
    out.push({ query: q, expect: [m.id, claim.slice(0, 6)] })
  }
  return out.slice(0, 100)
}

async function main() {
  const casesFile = arg('cases')
  let cases: Case[]
  if (casesFile) {
    try {
      cases = JSON.parse(fs.readFileSync(casesFile, 'utf8'))
    } catch (e: any) {
      console.error(`读不了用例文件：${e?.message || e}`)
      process.exit(2)
    }
  } else {
    cases = autoCases()
    console.log('（没有 --cases，用现有记忆自动生成自召回用例）')
  }

  if (!cases.length) {
    console.log('没有可评测的用例：这只鱼还没有合并记忆。先聊几轮、让它整理一次。')
    process.exit(0)
  }

  const hits = { 1: 0, 3: 0, 5: 0 } as Record<number, number>
  let mrr = 0
  let falseTop1 = 0
  const misses: { query: string; expect: string[]; got: string[] }[] = []

  for (const c of cases) {
    const found = useHybrid ? await mem.searchHybrid(c.query, { limit: Math.max(5, K) }) : mem.search(c.query, { limit: Math.max(5, K) })
    const rank = found.findIndex((h: any) =>
      c.expect.some((x) => h.id === x || String(h.text || '').includes(x) || String(h.record?.claim || '').includes(x)))
    if (rank >= 0) {
      mrr += 1 / (rank + 1)
      for (const k of [1, 3, 5]) if (rank < k) hits[k] += 1
    } else {
      misses.push({ query: c.query, expect: c.expect, got: found.slice(0, 3).map((h: any) => String(h.text || '').slice(0, 24)) })
    }
    if (rank !== 0 && found.length > 0) falseTop1 += 1
  }

  const n = cases.length
  const pct = (x: number) => ((x / n) * 100).toFixed(1) + '%'
  console.log('')
  console.log(`通道: ${useHybrid ? 'BM25 + 向量（RRF）' : 'BM25'}`)
  console.log(`用例: ${n}`)
  console.log(`recall@1: ${pct(hits[1])}`)
  console.log(`recall@3: ${pct(hits[3])}`)
  console.log(`recall@5: ${pct(hits[5])}`)
  console.log(`MRR:      ${(mrr / n).toFixed(3)}`)
  console.log(`top1 不是期望项: ${pct(falseTop1)}（误注入的近似指标）`)

  if (misses.length) {
    console.log('')
    console.log(`没找到的 ${misses.length} 条（看前 8 条）：`)
    for (const m of misses.slice(0, 8)) {
      console.log(`  ? ${m.query}  期望 ${m.expect.join(' / ')}`)
      console.log(`    实际 ${m.got.length ? m.got.join(' | ') : '（空）'}`)
    }
  }

  const r3 = hits[3] / n
  console.log('')
  if (r3 < 0.7) {
    console.log(`结论：recall@3 = ${(r3 * 100).toFixed(1)}% < 70%。按 §4.3，这时才值得做 embedding 的 A/B。`)
    console.log('      用 --hybrid 再跑一次对比（需先开 memory.embeddings）。')
  } else {
    console.log(`结论：recall@3 = ${(r3 * 100).toFixed(1)}% ≥ 70%。BM25 够用，先别上向量。`)
  }
}

main().catch((e) => {
  console.error(String(e?.stack || e))
  process.exit(1)
})
