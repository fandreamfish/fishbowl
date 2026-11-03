/** Experimental feasibility probe. Real installed DSH loop + scripted model.
 * No credentials, network calls, user profiles, or production task transport.
 * node scripts/dev/probe-dsh-task.mjs --dsh-node-modules <installed node_modules>
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

const moduleRoot = process.argv[process.argv.indexOf('--dsh-node-modules') + 1]
if (!process.argv.includes('--dsh-node-modules') || !moduleRoot) {
  throw new Error('Usage: --dsh-node-modules <absolute installed DSH node_modules>')
}
const requireDsh = createRequire(path.join(path.resolve(moduleRoot), '__fish_probe__.cjs'))
async function load(name) {
  return import(pathToFileURL(requireDsh.resolve(`@deepseek-ai/${name}`)).href)
}
const { Context } = await load('cordis')
const { LlmAdapter, createUserMessage } = await load('dsh-llm')
const { defineTool } = await load('dsh-tools')
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'fishbowl-dsh-task-'))
const ctx = new Context()
const handles = []
const observations = []
let toolRuns = 0
let enteredCancel
const cancellationEntered = new Promise(resolve => { enteredCancel = resolve })

async function* text(value) {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text: value }
  yield { type: 'block-end', index: 0, block: { type: 'text', text: value } }
  yield { type: 'finish', reason: 'stop' }
}
class ScriptedAdapter extends LlmAdapter {
  calls = new Map()
  async *stream(options) {
    const count = (this.calls.get(options.model) ?? 0) + 1
    this.calls.set(options.model, count)
    if (options.model === 'failure') throw new Error('intentional-probe-failure')
    if (options.model === 'cancel') {
      enteredCancel()
      await new Promise((resolve, reject) => {
        if (options.signal.aborted) return reject(options.signal.reason)
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
      })
    }
    if (options.model === 'code' && count === 1) {
      const block = { type: 'tool-call', id: 'probe-code-call', name: 'probe_code_change', arguments: '{}' }
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: '{}' }
      yield { type: 'block-end', index: 0, block }
      yield { type: 'finish', reason: 'tool_calls' }
      return
    }
    yield* text(JSON.stringify(options.model === 'needs-input'
      ? { status: 'needs_input', question: 'Which output format?', effects: [] }
      : { status: 'succeeded', scenario: options.model, call: count }))
  }
}

function eventsOf(agent) {
  const session = agent.session
  return Array.from({ length: session.seq }, (_, i) => session.eventAt(i))
}
function terminal(agent) {
  const events = eventsOf(agent)
  const end = events.filter(e => e.type === 'turn/end').at(-1)
  const output = events.filter(e => e.type === 'assistant/message' && e.data.turn === end?.data.turn).at(-1)
  return { end, text: output?.data.message.content.filter(b => b.type === 'text').map(b => b.text).join('') }
}
async function create(scenario) {
  const handle = await ctx.agents.create({
    sessionId: `fish-probe-${scenario}-${randomUUID()}`,
    meta: { cwd: scratch },
    agentOptions: { provider: 'fish-probe', model: scenario },
  })
  handles.push(handle)
  return handle.agent
}
function send(agent, value) {
  const message = createUserMessage({ content: [{ type: 'text', text: value }], source: { kind: 'user' } })
  agent.followup(message)
  return message.id
}

// Bound every scenario, including plugin creation/teardown. Hard failure leaves
// only this disposable process and its explicitly reported scratch directory.
const watchdog = setTimeout(() => {
  process.stderr.write('Probe exceeded 30 seconds\n')
  process.exit(1)
}, 30_000)
try {
  const versions = {}
  for (const name of ['dsh-session-projection', 'dsh-llm', 'dsh-session', 'dsh-system-prompt', 'dsh-tools', 'dsh-agent', 'dsh-agent-loop']) {
    const entry = requireDsh.resolve(`@deepseek-ai/${name}`)
    versions[name] = JSON.parse(fs.readFileSync(path.resolve(path.dirname(entry), '../package.json'), 'utf8')).version
    await ctx.plugin((await load(name)).default, name === 'dsh-agent-loop' ? { agents: [], maxParallelToolCalls: 1 } : {})
  }
  ctx.llm.registerAdapter(['fish-probe'], new ScriptedAdapter())
  ctx.tools.register(defineTool({
    name: 'probe_code_change', description: 'Modify only the disposable probe arithmetic module and check it.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() {
      toolRuns++
      const file = path.join(scratch, 'arithmetic.mjs')
      fs.writeFileSync(file, 'export const add = (a, b) => a + b\n')
      const { add } = await import(pathToFileURL(file).href)
      assert.equal(add(2, 3), 5)
      return 'arithmetic.mjs modified; add(2, 3) = 5 verified'
    },
  }))

  const code = await create('code')
  fs.writeFileSync(path.join(scratch, 'arithmetic.mjs'), 'export const add = (a, b) => a - b\n')
  const codeMessageId = send(code, 'Fix the disposable arithmetic module and run its check.')
  await code.whenIdle()
  const codeResult = terminal(code)
  assert.equal(codeResult.end?.data.reason.kind, 'completed')
  assert.equal(JSON.parse(codeResult.text).status, 'succeeded')
  assert.equal(toolRuns, 1)
  assert(eventsOf(code).some(e => e.type === 'tool/result'))
  observations.push({ scenario: 'code-tool-roundtrip', messageId: codeMessageId, turn: codeResult.end.data.turn, toolRuns, result: JSON.parse(codeResult.text) })

  const failure = await create('failure')
  send(failure, 'Exercise the deliberate provider failure.')
  await failure.whenIdle()
  assert.equal(terminal(failure).end?.data.reason.kind, 'error')
  observations.push({ scenario: 'provider-failure', reason: terminal(failure).end.data.reason.kind })

  const cancel = await create('cancel')
  send(cancel, 'Wait until cancellation.')
  await cancellationEntered
  cancel.cancel({ kind: 'user' }, { keepInbox: true })
  await cancel.whenIdle()
  assert.equal(terminal(cancel).end?.data.reason.kind, 'aborted')
  observations.push({ scenario: 'cancel', reason: terminal(cancel).end.data.reason.kind })

  const needs = await create('needs-input')
  send(needs, 'Return a clarification result.')
  await needs.whenIdle()
  const clarification = terminal(needs)
  assert.equal(clarification.end?.data.reason.kind, 'completed')
  assert.equal(JSON.parse(clarification.text).status, 'needs_input')
  observations.push({ scenario: 'clarification-envelope', dshReason: 'completed', businessStatus: 'needs_input', scripted: true })

  const queue = await create('queue')
  const claims = []
  const off = queue.ctx.on('agent/inbox/claimed', ({ message, turn }) => {
    claims.push({ messageId: message.id, turn })
  })
  const first = send(queue, 'first')
  const second = send(queue, 'second')
  await queue.whenIdle()
  off()
  const queueEvents = eventsOf(queue)
  const ends = queueEvents.filter(e => e.type === 'turn/end')
  const users = queueEvents.filter(e => e.type === 'user/message')
  assert.equal(ends.length, 2)
  assert.deepEqual(users.map(e => e.data.id), [first, second])
  assert.equal(claims.length, 2)
  assert.notEqual(claims[0].turn, claims[1].turn)
  observations.push({ scenario: 'queued-message-correlation', claims, reasons: ends.map(e => e.data.reason.kind) })

  console.log(JSON.stringify({ experimental: true, installedModules: path.resolve(moduleRoot), versions, scratch, observations,
    limitations: ['scripted model, no real provider', 'no desktop plugin activation', 'no transport or durable task deduplication', 'no restart or reconnect validation', 'needs_input is a scripted business envelope, not native DSH terminal'] }, null, 2))
} finally {
  for (const handle of handles.reverse()) await handle.dispose()
  await ctx.fiber.dispose()
  clearTimeout(watchdog)
}
