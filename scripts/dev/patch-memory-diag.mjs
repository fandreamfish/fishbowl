import fs from 'node:fs'

// 1) 提高总结输出上限
{
  const p = 'packages/memory/src/memory.ts'
  let t = fs.readFileSync(p, 'utf8')
  t = t.replace('            maxTokens: 500,', '            maxTokens: 900,')
  t = t.replace('            maxTokens: 300,', '            maxTokens: 600,')
  // 2) 失败重试改为按时间冷却，而不是永久放弃
  t = t.replace('      if ((this.tries.get(t.id) ?? 0) >= 2) continue', '      const tries = this.tries.get(t.id) ?? 0\n      const sinceTry = now - (this.triesAt.get(t.id) ?? 0)\n      if (tries >= 2 && sinceTry < 30 * 60_000) continue')
  t = t.replace('  private tries = new Map<string, number>()', '  private tries = new Map<string, number>()\n  private triesAt = new Map<string, number>()')
  t = t.replace('    this.tries.set(turnId, (this.tries.get(turnId) || 0) + 1)', '    this.tries.set(turnId, (this.tries.get(turnId) || 0) + 1)\n    this.triesAt.set(turnId, this.clock())')
  fs.writeFileSync(p, t)
  console.log('memory', t.includes('maxTokens: 900'), t.includes('triesAt'))
}

// 3) 把 tick 的错误写进 trace（否则永远不知道为何没总结）
{
  const p = 'packages/app/src/turn.js'
  let t = fs.readFileSync(p, 'utf8')
  t = t.replace("void mem.tick({ llm: memLlm(), by: { model: cfg.appraiser.model } })\n          .catch((err) => trace({ ts: Date.now(), sessionId: session.id, warn: `memory tick failed: ${String(err?.message || err)}` }))",
    "void mem.tick({ llm: memLlm(), by: { model: cfg.appraiser.model } })\n          .then((r) => {\n            const bad = [...(r.errors ?? []), ...(r.rejected ?? [])]\n            if (bad.length) trace({ ts: Date.now(), sessionId: session.id, warn: `memory tick: ${bad.slice(0, 3).join(' | ')}` })\n          })\n          .catch((err) => trace({ ts: Date.now(), sessionId: session.id, warn: `memory tick failed: ${String(err?.message || err)}` }))")
  t = t.replace("void memoryFor(c).tick({ llm: memLlm(), by: { model: fcfg.appraiser.model }, maxCalls: 8 })\n            .catch(() => { /* 下轮再试 */ })",
    "void memoryFor(c).tick({ llm: memLlm(), by: { model: fcfg.appraiser.model }, maxCalls: 8 })\n            .then((r) => {\n              const bad = [...(r.errors ?? []), ...(r.rejected ?? [])]\n              if (bad.length) trace({ ts: Date.now(), sessionId: c.meta.occupancy?.id, creatureId: c.meta.creatureId, warn: `memory sweep: ${bad.slice(0, 3).join(' | ')}` })\n            })\n            .catch(() => { /* 下轮再试 */ })")
  fs.writeFileSync(p, t)
  console.log('turn', t.includes('memory tick: '), t.includes('memory sweep:'))
}
