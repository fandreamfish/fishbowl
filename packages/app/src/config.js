/** 配置归一化：全部带默认值，缺什么补什么。 */
import os from 'node:os'
import path from 'node:path'
import { normalizeMemory } from '../../memory/src/index.ts'
import { normalizeContact, normalizeSelfTime, normalizeWake } from '../../schedule/src/index.ts'
import { normalizeDiary } from '../../journal/src/index.js'
import { normalizeAffect } from '../../affect/src/index.ts'
import { normalizeBrowseConfig, normalizeComment } from '../../bilibili/src/index.js'

/** @returns {import('./types.js').FishbowlConfig} */
export function normalizeConfig(raw = {}) {
  const a = raw.appraiser || {}
  // 兼容旧配置：只给 stateDir 时，把它的父目录当作数据根
  const dataRoot = raw.dataRoot || (raw.stateDir ? path.dirname(raw.stateDir) : path.join(os.homedir(), '.fishbowl'))
  const stateDir = raw.stateDir || path.join(dataRoot, 'creatures')
  const c = {
    // 个体状态目录：creatures/<creatureId>/（记忆永远不进会话日志，也永远不进 git）
    // 数据根目录（~/.fishbowl）：creatures/、home/、配置文件都在它下面
    dataRoot,
    stateDir,
    homeRoot: raw.homeRoot || path.join(dataRoot, 'home'),
    // 四条不变量之一：时区显式配置，不用系统时区
    timezone: raw.timezone || 'Asia/Shanghai',
    // 四条不变量之一：模型随个体绑定
    model: raw.model || 'deepseek-chat',

    // 评价器：scripted = 关键词启发式（离线可用）；deepseek = DeepSeek API 结构化输出
    appraiser: {
      kind: a.kind || 'scripted',
      apiKey: a.apiKey || '',
      baseUrl: a.baseUrl || 'https://api.deepseek.com',
      model: a.model || 'deepseek-chat',
    },

    // A/B 对照组：true = 只记录，不注入、不约束
    control: !!raw.control,
    // 注入与约束开关（调试用）
    injectBias: raw.injectBias !== false,
    applyConstraints: raw.applyConstraints !== false,

    // 空数组 = 管理所有会话；否则只管理列出的会话
    sessionFilter: Array.isArray(raw.sessionFilter) ? raw.sessionFilter : [],

    // 验证门槛：bias.thresholdVerify >= 此值时，危险工具先 ask
    verifyTools: Array.isArray(raw.verifyTools) ? raw.verifyTools : ['bash', 'pwsh'],
    verifyThreshold: typeof raw.verifyThreshold === 'number' ? raw.verifyThreshold : 0.6,
    // 拒绝门槛：bias.thresholdRefuse <= 此值时，拒绝破坏性工具
    refuseTools: Array.isArray(raw.refuseTools) ? raw.refuseTools : [],
    refuseThreshold: typeof raw.refuseThreshold === 'number' ? raw.refuseThreshold : 0.25,

    // 每轮工具调用上限（0 = 不限，默认关）。想限制她一轮动手次数时才打开。
    maxToolCallsPerTurn: (() => {
      const n = Number(raw.maxToolCallsPerTurn)
      return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0
    })(),

    transcriptLimit: raw.transcriptLimit || 2400,

    // 成长率（分层 g 在 core 里，这里给全局滑块）
    growth: typeof raw.growth === 'number' ? raw.growth : 1,

    // M17：记忆系统（docs/MEMORY.md §7）。默认值与钳制在 packages/memory/src/config.ts，一处维护。
    memory: normalizeMemory(raw.memory),

    // M2.4：关系原型（只影响语域与关系规则，不规定人格）
    relation: { kind: raw.relation?.kind || 'companion' },

    // M5：设置页可写的初始状态（基础人设 / 名字）
    seed: raw.seed
      ? { name: String(raw.seed.name ?? ''), background: String(raw.seed.background ?? '') }
      : null,

    // 日记：当天最后一件事；没写就第二天补
    diary: normalizeDiary(raw.diary),
    // 能力开关（每条鱼可单独关）：关掉后工具不注册/会拒绝，设置页也不显示对应页面
    capabilities: (() => {
      const c = raw.capabilities || {}
      const on = (v) => v !== false
      // 能力只有技能类：上网（含说话）。记忆不是能力，是她的本体
      return { browse: on(c.browse) }
    })(),
    // 心情半衰期（天）：每条鱼可单独改；0.1–60
    affect: normalizeAffect(raw.affect),
    // M3.0：清醒节律与主动联系（默认关闭——先观察，再打开）
    wake: normalizeWake(raw.wake),
    contact: normalizeContact(raw.contact),

    // M21：自处（醒来但不为了找他）。默认关；独立于联系配额。
    selfTime: normalizeSelfTime(raw.selfTime),

    // M21：上网（B 站只读）。工具始终注册；开关只决定能不能联网。
    browse: normalizeBrowseConfig(raw.browse),

    // M21.2：在 B 站说话（写操作，默认关）。cookie 在 bili-auth.json，不在这里。
    comment: normalizeComment(raw.comment),
  }
  return c
}

/**
 * 配置自检：DSH 设置页重写 profile patch 时可能把 fishbowl 的配置整段冲掉，
 * 表现就是"没有记忆、没有总结、情绪变笨"。这里只报告，不改配置。
 */
export function configHealth(cfg) {
  const issues = []
  if (cfg?.appraiser?.kind !== 'deepseek') issues.push('appraiser 不是 deepseek：没有 LLM 评价，记忆总结也不会跑')
  if (cfg?.appraiser?.kind === 'deepseek' && !cfg?.appraiser?.apiKey) issues.push('appraiser.apiKey 为空：调用会失败')
  if (!cfg?.wake?.enabled && !cfg?.selfTime?.enabled) issues.push('清醒节律与自处都关着：她不会主动醒来')
  return { ok: issues.length === 0, issues }
}
