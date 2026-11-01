/** 脚本化评价。真实系统里由异步 LLM 评价调用产出；这里手写，只测情绪→偏置链路。 */
import { appraisal } from '../packages/affect/src/index.ts'
import type { Appraisal } from '../packages/affect/src/index.ts'

export function rejection(): Appraisal {
  // "这个方案不行，重做。"
  return appraisal({ goalCongruence: -0.45, agency: 0.30, certainty: 0.80, relationalImpact: -0.15, stake: 0.55, attribution: 'other' })
}

export function hurry(): Appraisal {
  // "快点，别磨蹭。"
  return appraisal({ goalCongruence: -0.30, agency: 0.35, certainty: 0.55, relationalImpact: -0.05, stake: 0.45, attribution: 'other' })
}

export function promiseBroken(): Appraisal {
  // 它答应过，然后没做到。
  return appraisal({ goalCongruence: -0.50, agency: 0.80, certainty: 0.90, normViolation: 0.50, relationalImpact: -0.40, stake: 0.80, attribution: 'self' })
}

export function neutral(): Appraisal {
  return appraisal()
}

export function reunion(): Appraisal {
  return appraisal({ goalCongruence: 0.20, agency: 0.00, certainty: 0.80, relationalImpact: 0.60, stake: 0.70, attribution: 'other' })
}

export function tiny(): Appraisal {
  return appraisal({ goalCongruence: 0.05, stake: 0.10 })
}
