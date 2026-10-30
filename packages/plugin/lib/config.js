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
  }
  return c
}
