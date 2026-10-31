/**
 * 两次总结：她的看法（带情绪、可追加）与中性记录（冻结、用于索引）。
 * 提示词 + 防御性解析 + 拆分点的定位。
 */

export const HER_SYSTEM = [
  '你就是这条鱼。下面是你们刚才这一轮对话，以及你此刻的状态。',
  '写下你对这一轮的**真实看法**：可以高兴，可以不耐烦，可以觉得没意思，可以有点被冒犯，可以想岔开话题。',
  '规则：',
  '- 第一人称，一句话，不超过 120 字，口语。不要总结、不要工整、不要自我剖析。',
  '- 可以不喜欢、可以敷衍、可以只注意到一个细节。没人规定你必须体贴。',
  '- 不许说「作为 AI」，不许解释自己的机制，不许道歉式开场。',
  '- 另外：从「这轮注入过的记忆」里挑出你**真的用到了**的 id，没用就空数组。',
  '只输出 JSON：{ "herSummary": "…", "used": ["id…"] }',
].join('\n')

export const NEUTRAL_SYSTEM = [
  '你是记录员。把这一轮对话拆成「发生了哪几件独立的事」，每件一条。',
  '规则：',
  '- 第三人称，只写事实：谁、要什么、做了什么、结果是什么。',
  '- 每条不超过 150 字；quote 必须是原文里**逐字出现**的一段（不超过 40 字），用来定位，不许改写。',
  '- 不评价，不写情绪，不推测动机。',
  '- 一轮最多 3 条。没有实质内容就输出 1 条，如实写「只是寒暄」。',
  '- 另给 1–3 个主题标签，**只能**从词表里选：{{TAGS}}',
  '只输出 JSON：{ "segments": [{ "text": "…", "quote": "…" }], "tags": ["…"] }',
].join('\n')

export function buildHerUser(opts: { transcript: string; affect: any; injected: { id: string; text: string }[] }) {
  const a = opts.affect || {}
  const state = [
    `效价 ${Number(a.valence ?? 0).toFixed(2)}（负=难受，正=舒服）`,
    `唤醒 ${Number(a.arousal ?? 0).toFixed(2)}`,
    Number(a.guilt ?? 0) > 0.05 ? `愧疚 ${Number(a.guilt).toFixed(2)}` : '',
    Number(a.longing ?? 0) > 0.05 ? `想念 ${Number(a.longing).toFixed(2)}` : '',
  ].filter(Boolean).join('，')
  const inj = opts.injected.length
    ? '这轮注入过的记忆：\n' + opts.injected.map((i) => `- [${i.id}] ${i.text}`).join('\n')
    : '这轮没有注入记忆。'
  return `你此刻的状态：${state}\n\n${inj}\n\n这一轮对话：\n${opts.transcript}`
}

export function buildNeutralUser(opts: { transcript: string; prevLine?: string; tags: string[] }) {
  const prev = opts.prevLine ? `上一轮最后一句（仅供理解指代）：${opts.prevLine}\n\n` : ''
  return prev + '这一轮对话：\n' + opts.transcript
}

function jsonOf(text: string): any {
  const m = String(text ?? '').match(/\{[\s\S]*\}/)
  if (!m) return {}
  try {
    const v = JSON.parse(m[0])
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

/** { herSummary, used } —— 坏输出得到空，不抛。 */
export function parseHer(raw: string): { herSummary: string; used: string[] } {
  const j = jsonOf(raw)
  const text = typeof j.herSummary === 'string' ? j.herSummary.trim() : ''
  const used = Array.isArray(j.used) ? j.used.filter((x) => typeof x === 'string').slice(0, 12) : []
  return { herSummary: text.slice(0, 240), used }
}

/** { segments: [{text, quote}], tags } —— 最多 3 段，标签只留词表里的。 */
export function parseNeutral(raw: string, tags: string[]): { segments: { text: string; quote: string }[]; tags: string[] } {
  const j = jsonOf(raw)
  const list = Array.isArray(j.segments) ? j.segments : []
  const segments = list
    .filter((s) => s && typeof s.text === 'string' && s.text.trim())
    .slice(0, 3)
    .map((s) => ({ text: s.text.trim().slice(0, 400), quote: typeof s.quote === 'string' ? s.quote.trim().slice(0, 80) : '' }))
  const wanted = new Set(tags || [])
  const picked = (Array.isArray(j.tags) ? j.tags : [])
    .filter((t) => typeof t === 'string' && wanted.has(t.trim()))
    .slice(0, 3)
  return { segments, tags: picked }
}

/**
 * 在原文里逐字找一个 quote，返回字符区间。
 * 找不到就返回 null——这是防幻觉闸，不是尽力而为。
 */
export function locateQuote(note: string, quote: string): [number, number] | null {
  const text = String(note ?? '')
  const q = String(quote ?? '').trim()
  if (!text || !q) return null
  const i = text.indexOf(q)
  if (i >= 0) return [i, i + q.length]
  // 模型偶尔会吃掉首尾标点：退一步用前 12 个字再找一次
  const core = q.slice(0, Math.min(12, q.length))
  if (core.length >= 4) {
    const j = text.indexOf(core)
    if (j >= 0) return [j, j + core.length]
  }
  return null
}

/**
 * 把一轮拆成 1–3 段，并算出每段在原文里的字符区间。
 * 任何一段定位失败 → 整轮退回一段（宁可不拆，也不要切错）。
 */
export function splitSegments(note: string, segments: { text: string; quote: string }[]): { text: string; chars: [number, number] }[] {
  const whole = String(note ?? '')
  if (segments.length <= 1) return [{ text: segments[0]?.text ?? '', chars: [0, whole.length] }]

  const located = []
  for (const s of segments) {
    const r = locateQuote(whole, s.quote)
    if (!r) return [{ text: segments.map((x) => x.text).join(' '), chars: [0, whole.length] }]
    located.push({ text: s.text, start: r[0] })
  }
  located.sort((a, b) => a.start - b.start)
  return located.map((s, i) => ({
    text: s.text,
    chars: [s.start, i + 1 < located.length ? located[i + 1].start : whole.length],
  }))
}
