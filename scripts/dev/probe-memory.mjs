import fs from 'node:fs'

const patch = fs.readFileSync('C:/Users/24358/.dsh/profiles/desktop/cordis.patch.yml', 'utf8')
const key = (patch.match(/sk-[A-Za-z0-9]+/) || [])[0]
const { Memory } = await import('file:///D:/fish-memory/packages/memory/src/memory.ts')

const llm = async (req) => {
  const r = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model: req.model || 'deepseek-chat',
      messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
      max_tokens: req.maxTokens || 600,
      response_format: { type: 'json_object' },
    }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + JSON.stringify(j).slice(0, 200))
  return j.choices?.[0]?.message?.content ?? ''
}

const mem = new Memory({ dir: 'C:/Users/24358/.fishbowl/creatures/ec543a56-24b4-440a-9f93-dca453a91a6b', lock: 'off' })
const v = mem.view()
console.log('turns=', v.turns.length, 'memories=', v.memories.length, 'pending=', v.turns.length - v.watermark)
const rep = await mem.tick({ llm, by: { model: 'deepseek-chat' }, maxCalls: 12 })
console.log(JSON.stringify(rep))
console.log('after: turns=', mem.view().turns.length, 'summaries=', mem.view().turns.filter(t => t.neutral).length, 'memories=', mem.view().memories.length)
