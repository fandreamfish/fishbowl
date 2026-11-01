import fs from 'node:fs'
const p = 'packages/app/src/turn.js'
let t = fs.readFileSync(p, 'utf8')
// 缓存：同一轮内状态块不变（减少 system prompt 抖动）
t = t.replace("  function buildStateText(session) {\n    try {\n      if (cfg.control || !cfg.injectBias) return ''",
  "  const stateCache = new Map()\n  function buildStateText(session) {\n    try {\n      if (cfg.control || !cfg.injectBias) return ''\n      const key = session?.__fbTurn || 0\n      const hit = stateCache.get(session?.id)\n      if (hit && hit.key === key) return hit.text")
t = t.replace("      return snap.text + (grant ? `\\n他允许你的事: ${grant}` : '') + reqText + extra + (recent ? '\\n' + recent : '')",
  "      const out = snap.text + (grant ? `\\n他允许你的事: ${grant}` : '') + reqText + extra + (recent ? '\\n' + recent : '')\n      stateCache.set(session?.id, { key, text: out })\n      return out")
// 新回合刷新缓存键
t = t.replace("      } else if (t === 'turn/end') {\n        finishTurn(session)",
  "      } else if (t === 'turn/start') {\n        try { session.__fbTurn = Date.now() } catch { /* 只读会话就算了 */ }\n        stateCache.delete(session.id)\n      } else if (t === 'turn/end') {\n        finishTurn(session)")
fs.writeFileSync(p, t)
console.log('patched', t.includes('stateCache'), t.includes("__fbTurn"))
