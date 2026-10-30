/** 工具约束：情绪 → 工具策略。
 *  - guard：同步、单调拒绝（破坏性工具 + 低拒绝门槛）
 *  - tools/pre-execute：返回 { kind: 'ask' }（危险工具 + 高验证门槛）
 * 决策函数是纯函数，可独立测试；宿主形状用防御性提取，联调前复核。
 */

/** @param {import('../../src/core/types.ts').Bias} bias */
export function verifyDecision(bias, toolName, cfg) {
  if (!toolName || !cfg.verifyTools.includes(toolName)) return null
  if (bias.thresholdVerify >= cfg.verifyThreshold) {
    return {
      kind: 'ask',
      reason: `fishbowl: 验证门槛 ${bias.thresholdVerify.toFixed(2)} ≥ ${cfg.verifyThreshold}，先确认再执行 ${toolName}`,
    }
  }
  return null
}

/** @param {import('../../src/core/types.ts').Bias} bias */
export function refuseReason(bias, toolName, cfg) {
  if (!toolName || !cfg.refuseTools.includes(toolName)) return null
  if (bias.thresholdRefuse <= cfg.refuseThreshold) {
    return `fishbowl: 拒绝门槛 ${bias.thresholdRefuse.toFixed(2)} ≤ ${cfg.refuseThreshold}，当前状态拒绝执行 ${toolName}`
  }
  return null
}

/** @param {import('./types.js').FishbowlConfig} cfg */
export function createConstraints(ctx, binding, cfg) {
  const disposers = []

  if (typeof ctx.tools?.guard === 'function') {
    const off = ctx.tools.guard((exec) => {
      if (cfg.control || cfg.refuseTools.length === 0) return null
      const sid = sessionIdOf(exec)
      if (!sid || !binding.manages(sid)) return null
      const bias = binding.creatureFor(sid).bias()
      return refuseReason(bias, toolNameOf(exec), cfg)
    })
    if (off) disposers.push(off)
  }

  const off = ctx.on('tools/pre-execute', (exec, next) => {
    if (!next) return undefined
    if (cfg.control) return next()
    const sid = sessionIdOf(exec)
    if (!sid || !binding.manages(sid)) return next()
    const name = toolNameOf(exec)
    if (!name) return next()
    const bias = binding.creatureFor(sid).bias()
    const dec = verifyDecision(bias, name, cfg)
    if (!dec) return next()
    return dec
  })
  if (off) disposers.push(off)

  return () => {
    for (const d of disposers) { try { d() } catch { /* 尽力清理 */ } }
  }
}

function sessionIdOf(exec) {
  const a = exec?.agent
  return a?.session?.id || a?.id || exec?.sessionId || null
}

function toolNameOf(exec) {
  return exec?.toolName || exec?.name || exec?.tool?.name || ''
}
