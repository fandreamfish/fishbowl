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
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createBinding } from './lib/binding.js'
import { createCollector } from './lib/collector.js'
import { createConstraints } from './lib/constraints.js'
import { normalizeConfig } from './lib/config.js'
import { createWakeLoop } from './lib/life.js'
import { createUiRoute, mergeUiConfig, uiConfigPath } from './lib/ui-route.js'

export const inject = ['tools', 'agents']

// 配置走 profile 的 cordis.patch.yml；不导出 Config schema（零依赖铁律，见 AGENTS.md 同款约束）。


export function apply(ctx, config = {}) {
  // 设置页保存的配置（ui-config.json）覆盖 patch 配置里的 growth / seed
  const raw = { ...(config ?? {}) }
  try {
    const sd = raw.stateDir || path.join(os.homedir(), '.fishbowl', 'creatures')
    const ui = JSON.parse(fs.readFileSync(uiConfigPath(sd), 'utf8'))
    Object.assign(raw, mergeUiConfig(raw, ui))
  } catch { /* 没有 UI 配置就用 patch 配置 */ }

  const cfg = normalizeConfig(raw)
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

  // M5：设置页后端（状态 / 配置）
  const offUi = createUiRoute(ctx, cfg, binding)
  if (offUi) disposers.push(offUi)

  return () => {
    for (const d of disposers) {
      try { d() } catch { /* 卸载时尽力清理 */ }
    }
  }
}
