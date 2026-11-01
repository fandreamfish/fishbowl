/**
 * 许可策略：工具只问这里，不再各自拼 findPermit/consumePermit 与拒绝文案。
 */
import { consumePermit, findPermit } from './permits.ts'

export interface PermitCheck {
  ok: boolean
  permit?: any
  reason?: string
}

/**
 * @param action 'browse' | 'comment.post' | ...
 * @param required 配置里的 requirePermit
 * @param autoApprove 配置里的 autoApprove（明确说过不用每次问）
 */
export function checkPermission(
  creature: any,
  action: string,
  { required = false, autoApprove = false, target = '' }: { required?: boolean; autoApprove?: boolean; target?: string } = {},
): PermitCheck {
  if (autoApprove) return { ok: true }
  const permit = findPermit(creature, action, target) ?? undefined
  if (permit) return { ok: true, permit }
  if (!required) return { ok: true }
  const apply = action === 'browse' ? 'browse' : action
  return { ok: false, reason: `需要许可才能调用：先用 fish_ask_permission(action=${apply}) 问他。` }
}

/** 用掉一次许可（没有许可就什么也不做）。 */
export function usePermit(creature: any, permit: any): void {
  if (permit) consumePermit(creature, permit)
}
