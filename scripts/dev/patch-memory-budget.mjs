import fs from 'node:fs'
const p = 'packages/app/src/turn.js'
let t = fs.readFileSync(p, 'utf8')
t = t.replace("void mem.tick({ llm: memLlm(), by: { model: cfg.appraiser.model } })", "void mem.tick({ llm: memLlm(), by: { model: cfg.appraiser.model }, maxCalls: 12 })")
t = t.replace("void memoryFor(c).tick({ llm: memLlm(), by: { model: fcfg.appraiser.model }, maxCalls: 8 })", "void memoryFor(c).tick({ llm: memLlm(), by: { model: fcfg.appraiser.model }, maxCalls: 12 })")
// 打开房间时补一轮（把积压的总结尽快补齐）
t = t.replace("      host.stateSection?.(agent, (context) => buildStateText(context?.agent?.session ?? agent?.session ?? { id: sid }))",
  "      host.stateSection?.(agent, (context) => buildStateText(context?.agent?.session ?? agent?.session ?? { id: sid }))\n      // 打开房间时补一轮总结：积压不必等到下次对话或十分钟清扫\n      try {\n        const fcfg = configFor(cfg, creature)\n        if (fcfg.appraiser?.kind === 'deepseek') {\n          void memoryFor(creature).tick({ llm: memLlm(), by: { model: fcfg.appraiser.model }, maxCalls: 12 }).catch(() => {})\n        }\n      } catch { /* 补总结失败不影响对话 */ }")
fs.writeFileSync(p, t)
console.log('patched', t.includes('maxCalls: 12'), t.includes('打开房间时补一轮总结'))
