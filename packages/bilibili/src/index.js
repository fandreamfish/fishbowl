/**
 * @fishbowl/bilibili 的公共接口。
 * 内部文件（client/comment/store/...）不对外；用例层只用这里的门面。
 * 同名符号只从一处导出（normalizeCookie 用 client 的，isRiskCode 用 client 的）。
 */
export * from './browse.ts'
export {
  setPacing, getPacing, resetRisk, inCooldown, cooldownLeft, mixinKey, signQuery,
  unescapeHtml, stripEm, fmtDur, parseDanmaku, normalizeCookie, createClient,
} from './client.js'
export { RISK_FILE, STRIKES_MIN, riskPath, readRisk, writeRisk, noteRisk, clearRisk, markRiskOk, riskState } from './risk.js'
export * from './store.js'
export * from './comment.js'
export { authPath, readAuth, writeAuth, publicAuth, parseCookieInput, saveAuth, saveAccount, clearCookie, mentionPrefix } from './auth.js'
export * from './runtime.js'
export * from './config.js'
