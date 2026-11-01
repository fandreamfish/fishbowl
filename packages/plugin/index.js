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
import { createBinding } from '../app/src/binding.js'
import { createCollector } from '../app/src/turn.js'
import { createConstraints } from './lib/constraints.js'
import { normalizeConfig } from '../app/src/config.js'
import { createWakeLoop } from '../app/src/wake.js'
import { createMemoryStore } from '../app/src/memory-store.js'
import { createMemoryTool } from './memory/tool.js'
import { createBrowseTool } from './lib/browse/tool.js'
import { createSpeakTool } from './lib/browse/speak-tool.js'
import { setPacing } from '../bilibili/src/client.js'
import { createUiRoute, mergeUiConfig, uiConfigPath } from '../adapter-dsh/src/http.js'
import { configFor, migrateFishConfigs } from '../app/src/fishcfg.js'
import { createDshHost } from '../adapter-dsh/src/host.js'

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
  const host = createDshHost(ctx, cfg)
  const disposers = []
  const binding = createBinding(cfg)

  // 以前配置是全家的：给每条还没有自己配置的鱼写一份快照，之后各改各的
  try {
    const legacy = JSON.parse(fs.readFileSync(uiConfigPath(cfg.stateDir), 'utf8'))
    migrateFishConfigs(cfg, binding.listCreatures(), legacy)
  } catch { /* 没有旧配置就不用迁 */ }

  /** 子系统失败只记一笔，绝不拖垮激活（宿主启动的底线）。 */
  function safe(name, fn) {
    try {
      const off = fn()
      if (typeof off === 'function') disposers.push(off)
    } catch (err) {
      try {
        fs.appendFileSync(path.join(cfg.stateDir, 'trace.ndjson'), JSON.stringify({
          ts: Date.now(), warn: `${name} init failed: ${String(err && err.message || err)}`,
        }) + '\n')
      } catch { /* 记不下来也只能算 */ }
    }
  }

  // 记忆系统：一个进程内、一只鱼一份；收集器与 memory_search 工具共用
  const memoryFor = createMemoryStore(cfg)

  if (ctx.tools && cfg.applyConstraints) {
    safe('constraints', () => createConstraints(ctx, binding, cfg, host))
  }


  // M21：她自己上网看（docs/BROWSE.md）。
  // M37：能力按鱼配置——全都没开就不注册；改完配置可以重注册。
  let toolOffs = []
  function anyFishHas(cap) {
    try {
      return (binding.listCreatures?.() ?? []).some((c) => configFor(cfg, c).capabilities?.[cap] !== false)
    } catch {
      return true
    }
  }
  function registerCapabilityTools() {
    for (const off of toolOffs) { try { off() } catch { /* 旧工具卸载失败也继续 */ } }
    toolOffs = []
    if (!ctx.tools) return
    try { setPacing(cfg.browse?.pacing) } catch { /* 节奏坏值不影响激活 */ }
    const add = (fn) => {
      try {
        const off = fn()
        if (typeof off === 'function') toolOffs.push(off)
      } catch (err) { traceWarn('tool', err) }
    }
    if (anyFishHas('browse')) add(() => host.registerTool(createBrowseTool(binding, cfg)))
    if (anyFishHas('browse')) add(() => host.registerTool(createSpeakTool(binding, cfg)))
    if (cfg.memory?.searchTool !== false) add(() => host.registerTool(createMemoryTool(binding, cfg, memoryFor)))
  }
  registerCapabilityTools()

  if (ctx.agents) {
    safe('collector', () => createCollector(ctx, binding, cfg, host, memoryFor))

    // M3.0：清醒节律与主动联系（默认关闭）。设置页改了作息要能重开循环。
    let wakeOff = null
    const startWake = () => {
      try { wakeOff?.() } catch { /* 旧循环清理失败也继续 */ }
      wakeOff = null
      try {
        const off = createWakeLoop(ctx, binding, cfg, host)
        if (typeof off === 'function') wakeOff = off
      } catch (err) {
        traceWarn('wake', err)
      }
    }
    startWake()
    disposers.push(() => { try { wakeOff?.() } catch { /* 忽略 */ } })

    // M5：设置页后端（状态 / 配置）；作息改动通过 restartWake 即时生效
    safe('ui-route', () => createUiRoute(ctx, cfg, binding, host, { restartWake: startWake, refreshTools: registerCapabilityTools }))
  } else {
    safe('ui-route', () => createUiRoute(ctx, cfg, binding, host))
  }

  /** 子系统失败只记一笔，绝不拖垮激活（宿主启动的底线）。 */
  function traceWarn(name, err) {
    try {
      fs.appendFileSync(path.join(cfg.stateDir, 'trace.ndjson'), JSON.stringify({
        ts: Date.now(), warn: `${name} init failed: ${String(err && err.message || err)}`,
      }) + '\n')
    } catch { /* 记不下来也只能算 */ }
  }

  return () => {
    for (const d of disposers) {
      try { d() } catch { /* 卸载时尽力清理 */ }
    }
    try { memoryFor.closeAll?.() } catch { /* 放掉写锁 */ }
  }
}
