/**
 * fishbowl —— 把经历压成倾向。
 *
 * M1 范围（单 profile、单会话起用、单个个体）：
 *   1. 收集：订阅会话事件，turn/end 时把整轮压成一条 episode
 *   2. 评价：轮次结束后异步一次评价（关键词版 / DeepSeek API 版）→ 情绪 → 6 个决策旋钮
 *   3. 注入：把结构化状态摘要 agent.inject() 进下一轮（不唤醒）
 *   4. 约束：tools.guard() 实现拒绝、tools/pre-execute 返回 ask 实现"先验证再动手"
 *
 * 因果方向：本轮的偏置由上一轮及更早的事件算出。这一轮的情绪不参与这一轮的判断。
 *
 * A/B 对照组：config.control = true —— 只记录评价与偏置轨迹，不注入、不约束。
 */
import { createBinding } from './lib/binding.js'
import { createCollector } from './lib/collector.js'
import { createConstraints } from './lib/constraints.js'
import { normalizeConfig } from './lib/config.js'
import { createWakeLoop } from './lib/life.js'

export const inject = ['tools', 'agents']

// 注意：暂不导出 Config schema（schemastery 在宿主侧连续两轮导致启用失败）。
// 配置一律走 profile 的 cordis.patch.yml，见 packages/plugin/README.md。

export function apply(ctx, config = {}) {
  const cfg = normalizeConfig(config)
  const disposers = []
  const binding = createBinding(cfg)

  if (ctx.tools && cfg.applyConstraints) {
    const off = createConstraints(ctx, binding, cfg)
    if (off) disposers.push(off)
  }

  if (ctx.agents) {
    const off = createCollector(ctx, binding, cfg)
    if (off) disposers.push(off)

    // M3.0：清醒节律与主动联系（默认关闭）
    const offLife = createWakeLoop(ctx, binding, cfg)
    if (offLife) disposers.push(offLife)
  }

  return () => {
    for (const d of disposers) {
      try { d() } catch { /* 卸载时尽力清理 */ }
    }
  }
}
