/** 配置归一化：全部带默认值，缺什么补什么。 */
import os from 'node:os'
import path from 'node:path'
import { normalizeMemory } from '../../memory/src/config.ts'
import { normalizeBrowseConfig } from '../../bilibili/src/browse.ts'

/** @returns {import('./types.js').FishbowlConfig} */
export function normalizeConfig(raw = {}) {
  const a = raw.appraiser || {}
  const c = {
    // 个体状态目录：creatures/<creatureId>/（记忆永远不进会话日志，也永远不进 git）
    stateDir: raw.stateDir || path.join(os.homedir(), '.fishbowl', 'creatures'),
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
    diary: (() => {
      const d = raw.diary || {}
      const hm = (v, dflt) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v ?? '')) ? String(v) : dflt)
      return { enabled: d.enabled !== false, start: hm(d.start, '21:30'), end: hm(d.end, '23:59'), catchUp: d.catchUp !== false }
    })(),
    // 能力开关（每条鱼可单独关）：关掉后工具不注册/会拒绝，设置页也不显示对应页面
    capabilities: (() => {
      const c = raw.capabilities || {}
      const on = (v) => v !== false
      // 两个总开关：上网（含说话）与记忆（含检索）
      return { browse: on(c.browse), memory: on(c.memory ?? c.memorySearch) }
    })(),
    // 心情半衰期（天）：每条鱼可单独改；0.1–60
    affect: (() => {
      const a = raw.affect || {}
      const days = (v, dflt) => (Number.isFinite(Number(v)) ? Math.min(60, Math.max(0.1, Number(v))) : dflt)
      // 只有负面情绪可配；positive（温暖/好奇）不受这里影响
      return { guiltDays: days(a.guiltDays, 3), longingDays: days(a.longingDays, 2), negativeDays: days(a.negativeDays ?? a.namedDays, 2) }
    })(),
    // M3.0：清醒节律与主动联系（默认关闭——先观察，再打开）
    wake: {
      enabled: raw.wake?.enabled === true,
      firstDelayMs: Number.isFinite(Number(raw.wake?.firstDelayMs)) ? Number(raw.wake.firstDelayMs) : 10000,
      absenceHours: Number(raw.wake?.absenceHours) > 0 ? Number(raw.wake.absenceHours) : 8,
      activeWindow: raw.wake?.activeWindow ?? ['08:00', '23:30'],
      interval: raw.wake?.interval ?? { mode: 'fixed', min: '60m' },
      dwell: raw.wake?.dwell ?? ['1m', '3m'],
      idleSkip: raw.wake?.idleSkip ?? true,
      stateMultiplier: raw.wake?.stateMultiplier ?? { active: 1, fading: 4, dormant: 24 },
    },
    contact: {
      window: raw.contact?.window ?? ['09:00', '22:30'],
      dailyMax: raw.contact?.dailyMax ?? 2,
      minGap: raw.contact?.minGap ?? '3h',
      burst: raw.contact?.burst ?? { max: 1, per: '2h' },
      requireReason: raw.contact?.requireReason ?? true,
      unansweredStop: raw.contact?.unansweredStop ?? 3,
    },

    // M21：自处（醒来但不为了找他）。默认关；独立于联系配额。
    selfTime: {
      enabled: raw.selfTime?.enabled === true,
      window: (() => {
        const w = raw.selfTime?.window
        return Array.isArray(w) && w.length === 2 && w.every((x) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(x)))
          ? [String(w[0]), String(w[1])]
          : ['09:00', '23:00']
      })(),
      dailyMax: Number.isFinite(Number(raw.selfTime?.dailyMax)) ? Math.max(0, Math.min(6, Math.round(Number(raw.selfTime.dailyMax)))) : 1,
      minGap: /^\d+(?:\.\d+)?\s*[smhd]$/.test(String(raw.selfTime?.minGap ?? '')) ? String(raw.selfTime.minGap) : '90m',
      idleWaitMs: Number.isFinite(Number(raw.selfTime?.idleWaitMs)) ? Math.max(0, Math.min(120000, Number(raw.selfTime.idleWaitMs))) : 15000,
    },

    // M21：上网（B 站只读）。工具始终注册；开关只决定能不能联网。
    browse: normalizeBrowseConfig(raw.browse),

    // M21.2：在 B 站说话（写操作，默认关）。cookie 在 bili-auth.json，不在这里。
    comment: {
      enabled: raw.comment?.enabled === true,
      perDay: Number.isFinite(Number(raw.comment?.perDay)) ? Math.max(0, Math.min(5, Math.round(Number(raw.comment.perDay)))) : 1,
      replyPerDay: Number.isFinite(Number(raw.comment?.replyPerDay)) ? Math.max(0, Math.min(10, Math.round(Number(raw.comment.replyPerDay)))) : 2,
      replyToReplies: raw.comment?.replyToReplies !== false,
      scanEveryMin: Number.isFinite(Number(raw.comment?.scanEveryMin)) ? Math.max(5, Math.min(720, Math.round(Number(raw.comment.scanEveryMin)))) : 30,
      window: (() => {
        const w = raw.comment?.window
        return Array.isArray(w) && w.length === 2 && w.every((x) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(x)))
          ? [String(w[0]), String(w[1])]
          : ['20:00', '23:00']
      })(),
      atOwner: raw.comment?.atOwner !== false,
    },
  }
  return c
}
