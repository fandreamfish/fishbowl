import fs from 'node:fs'
const p = 'packages/being/src/creature.ts'
let lines = fs.readFileSync(p, 'utf8').split(/\r?\n/)
const targets = {
  'hasDiary(': 'return hasDiaryOf(this, date)',
  'recordDiary(': 'recordDiaryOf(this, date, text, ts)',
  'diaries(': 'return diariesOf(this, limit)',
  'recordNote(': 'recordNoteOf(this, text, ts)',
  'notes(': 'return notesOf(this, limit)',
  'recordRequest(': 'recordRequestOf(this, text, ts)',
  'answerRequest(': 'answerRequestOf(this, ref, answer, ts)',
  'requests(': 'return requestsOf(this)',
  'requestCountSince(': 'return requestCountSinceOf(this, since)',
  'pendingRequests(': 'return pendingRequestsOf(this)',
  'requestDigest(': 'return requestDigestOf(this, now)',
}
for (const [sig, body] of Object.entries(targets)) {
  const start = lines.findIndex((l) => l.includes(sig) && /^\s{2}[a-zA-Z]/.test(l) && l.includes('{'))
  if (start < 0) { console.log('missing', sig); continue }
  let depth = 0
  let end = -1
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) { if (ch === '{') depth++; else if (ch === '}') depth-- }
    if (depth === 0 && i > start) { end = i; break }
  }
  if (end < 0) { console.log('no end', sig); continue }
  const indent = '    '
  const out = [lines[start], indent + body, '  }']
  lines.splice(start, end - start + 1, ...out)
}
let text = lines.join('\n')
if (!text.includes('journal-facets')) {
  text = text.replace("import { uid } from './util.ts'", "import { uid } from './util.ts'\nimport {\n  hasDiary as hasDiaryOf, recordDiary as recordDiaryOf, diaries as diariesOf,\n  recordNote as recordNoteOf, notes as notesOf,\n  recordRequest as recordRequestOf, answerRequest as answerRequestOf,\n  requests as requestsOf, requestCountSince as requestCountSinceOf,\n  pendingRequests as pendingRequestsOf, requestDigest as requestDigestOf,\n} from './journal-facets.ts'")
}
fs.writeFileSync(p, text)
console.log('done')
