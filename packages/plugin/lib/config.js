/** 配置归一化：全部带默认值，缺什么补什么。 */
import os from 'node:os'
import path from 'node:path'

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

    transcriptLimit: raw.transcriptLimit || 2400,

    // M2：成长率（分层 g 在 core 里，这里先给全局；M2.3 再分层）
    growth: typeof raw.growth === 'number' ? raw.growth : 1,

    // M2.4：关系原型（只影响语域与关系规则，不规定人格）
    relation: { kind: raw.relation?.kind || 'companion' },

    // M5：设置页可写的初始状态（基础人设 / 名字）
    seed: raw.seed
      ? { name: String(raw.seed.name ?? ''), background: String(raw.seed.background ?? '') }
      : null,

    // M3.0：清醒节律与主动联系（默认关闭——先观察，再打开）
    wake: {
      enabled: raw.wake?.enabled === true,
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
  }
  return c
}
