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

/**
 * Config schema：设置页据此自动渲染配置编辑器。
 * 动态 import + 失败降级：schemastery 解析不到时插件照常工作，只是没有配置编辑器。
 * 依赖装在 packages/plugin/node_modules（npm 镜像安装），见 package.json。
 */
let Schema = null
try {
  ({ default: Schema } = await import('@deepseek-ai/schemastery'))
} catch { /* 没有编辑器也不影响功能 */ }

function buildConfig() {
  return Schema.object({
    timezone: Schema.string().description('时区（显式配置，不用系统时区）').default('Asia/Shanghai'),
    model: Schema.string().description('绑定的模型（换脑必须显式）').default('deepseek-chat'),
    growth: Schema.number().description('成长率滑块：越高学得越快、忘得越快').default(1),
    control: Schema.boolean().description('A/B 对照组：只记录，不注入不约束').default(false),
    injectBias: Schema.boolean().description('注入状态摘要').default(true),
    applyConstraints: Schema.boolean().description('工具约束（ask/拒绝）').default(true),
    transcriptLimit: Schema.number().description('转录长度上限').default(2400),
    appraiser: Schema.object({
      kind: Schema.union(['scripted', 'deepseek']).description('scripted=关键词版（离线）；deepseek=LLM 评价（推荐）').default('scripted'),
      apiKey: Schema.string().description('DeepSeek API key（只在 deepseek 模式下需要）').default(''),
      baseUrl: Schema.string().default('https://api.deepseek.com'),
      model: Schema.string().default('deepseek-chat'),
    }),
    relation: Schema.object({
      kind: Schema.union(['companion', 'friend']).description('关系原型（只影响语域，不规定人格）').default('companion'),
    }),
    wake: Schema.object({
      enabled: Schema.boolean().description('清醒节律与主动联系（先观察后打开）').default(false),
      activeWindow: Schema.array(Schema.string()).default(['08:00', '23:30']),
      interval: Schema.object({
        mode: Schema.union(['fixed', 'random']).default('fixed'),
        min: Schema.string().default('60m'),
        max: Schema.string().default(''),
      }),
      dwell: Schema.array(Schema.string()).default(['1m', '3m']),
      idleSkip: Schema.boolean().default(true),
      stateMultiplier: Schema.object({}).description('活跃/淡出/休眠的节律倍率'),
    }),
    contact: Schema.object({
      window: Schema.array(Schema.string()).default(['09:00', '22:30']),
      dailyMax: Schema.number().description('每天主动联系上限').default(2),
      minGap: Schema.string().description('两次之间最短间隔').default('3h'),
      burst: Schema.object({ max: Schema.number().default(1), per: Schema.string().default('2h') }),
      requireReason: Schema.boolean().default(true),
      unansweredStop: Schema.number().default(3),
    }),
  })
}

export const Config = Schema
  ? (() => { try { return buildConfig() } catch { return undefined } })()
  : undefined

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
