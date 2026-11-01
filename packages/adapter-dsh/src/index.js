/**
 * @fishbowl/adapter-dsh 的公共接口。
 * 入口插件只用这里的 createDshHost / createUiRoute；内部资源文件不对外。
 */
export { createDshHost } from './host.js'
export {
  createUiRoute, mergeUiConfig, saveUiConfig, seedChanged, uiConfigPath,
  validateMemoryConfig, summarizeEvent, subjectOf, otherWriter, memoryDetail,
} from './http.js'
export { pickCommentConfig, pickMemoryConfig, pickRoutineConfig } from '../../app/src/index.js'
