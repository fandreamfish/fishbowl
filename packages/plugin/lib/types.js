/**
 * @typedef {object} FishbowlConfig
 * @property {string} stateDir           个体状态目录（默认 ~/.fishbowl/creatures）
 * @property {string} timezone           显式时区（默认 Asia/Shanghai）
 * @property {string} model              绑定模型（换脑必须显式）
 * @property {{kind: 'scripted'|'deepseek', apiKey: string, baseUrl: string, model: string}} appraiser
 * @property {boolean} control           A/B 对照组：只记录，不注入、不约束
 * @property {boolean} injectBias        注入状态摘要
 * @property {boolean} applyConstraints  工具约束
 * @property {string[]} sessionFilter    空 = 管理所有会话
 * @property {string[]} verifyTools      高验证门槛时先 ask 的工具
 * @property {number} verifyThreshold
 * @property {string[]} refuseTools      低拒绝门槛时 guard 拒绝的工具
 * @property {number} refuseThreshold
 * @property {number} transcriptLimit    转录长度上限
 */
export {}
