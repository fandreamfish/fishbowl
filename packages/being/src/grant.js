/**
 * 许可（grant）的识别。
 *
 * 「你没事可以刷刷 B 站」不是命令，是允许。
 * 它记一条事件，让她以后在自处时知道自己可以；它不翻转设置页的硬开关。
 *
 * 只解析**用户发来的消息**（不是网页素材，不是她自己的话）。
 */
import { activeGrants } from './signals.ts'

const BILI = '(?:b\\s*站|bilibili|哔哩|哔哩哔哩)'
const ACT = '(?:刷|看|逛|翻|瞄)'

const GRANT_RE = new RegExp(
  `(?:没事|有空|闲|无聊|平时|以后|自己)[^。！？!?\\n]{0,24}(?:可以|就|能|去|自己)[^。！？!?\\n]{0,12}${ACT}[^。！？!?\\n]{0,12}${BILI}`
  + `|(?:可以|允许|准你|让你)[^。！？!?\\n]{0,12}(?:没事|有空|自己)?[^。！？!?\\n]{0,8}${ACT}[^。！？!?\\n]{0,10}${BILI}`
  + `|${BILI}[^。！？!?\\n]{0,12}(?:可以|随便|没事)[^。！？!?\\n]{0,8}${ACT}`,
  'i',
)

const REVOKE_RE = new RegExp(
  `(?:别|不要|不许|不准|禁止|少|停止|别再)[^。！？!?\\n]{0,12}${ACT}[^。！？!?\\n]{0,12}${BILI}`
  + `|${BILI}[^。！？!?\\n]{0,12}(?:不许|不准|别|不要)[^。！？!?\\n]{0,8}${ACT}`
  // 已经给过许可时，「别刷了」这种简短的话也算撤销；只收非常窄的句式，避免误伤。
  + `|^(?:别|不要|不许|不准|停止|别再)\\s*(?:刷|看)\\s*(?:了|吧|啊)?\\s*[。！!]?$`,
  'i',
)

/** 这句话是不是在给她一个「没事可以刷」的许可。 */
export function detectGrant(text) {
  const s = String(text ?? '').trim()
  if (!s || s.length > 200) return null
  // 「你可以刷 B 站吗」是在问她能不能，不是许可；除非句子里明确带「没事/有空」。
  if ((/[?？]/.test(s) || /吗\s*$/.test(s)) && !/(没事|有空|无聊|平时)/.test(s)) return null
  if (REVOKE_RE.test(s)) return { topic: 'browse', text: s, allowed: false }
  if (GRANT_RE.test(s)) return { topic: 'browse', text: s, allowed: true }
  return null
}

/** 是不是在撤销。 */
export function detectRevoke(text) {
  return REVOKE_RE.test(String(text ?? ''))
}

/** 当前有效的上网许可（同一 topic 以最后一条为准）。 */
export function browseGrant(creature) {
  try {
    const list = activeGrants(creature, 'browse')
    return list.length ? list[list.length - 1] : null
  } catch {
    return null
  }
}

/**
 * 注入/自处处境里的一句话。
 * 是事实，不是祈使句：不写「所以你去看看」。
 */
export function grantLine(creature) {
  const g = browseGrant(creature)
  return g ? '你没事可以自己刷刷 B 站。' : ''
}
