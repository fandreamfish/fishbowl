import fs from 'node:fs'

// 1) turn/start 注入延后一拍
{
  const p = 'packages/app/src/turn.js'
  let t = fs.readFileSync(p, 'utf8')
  t = t.replace("      } else if (t === 'turn/start') {\n        void injectState(session)", "      } else if (t === 'turn/start') {\n        // 让本次 append 先发布完，再注入\n        setTimeout(() => { void injectState(session) }, 0)")
  fs.writeFileSync(p, t)
  console.log('turn defer', t.includes('setTimeout(() => { void injectState(session) }, 0)'))
}

// 2) 回答请求：没有活 agent 就写进 outbox；失败记 trace
{
  const p = 'packages/adapter-dsh/src/resources/fish.js'
  let t = fs.readFileSync(p, 'utf8')
  const old = [
    "      const occ = c.meta.occupancy",
    "      const agent = occ?.kind === 'session' ? host.agentFor?.(occ.id) : null",
    "      if (agent) {",
    "        const word = body.answer === 'yes' ? '同意' : '不同意'",
    "        const text = `（他回答了你的请求「${reqText}」：${word}。想做什么就做，不想做也行。）`",
    "        await host.wake(agent, injectMessage(text, { mode: 'contact', reason: '请求有回音' }))",
    "      }",
  ].join('\n')
  const neu = [
    "      const occ = c.meta.occupancy",
    "      const agent = occ?.kind === 'session' ? host.agentFor?.(occ.id) : null",
    "      const word = body.answer === 'yes' ? '同意' : '不同意'",
    "      const text = `（他回答了你的请求「${reqText}」：${word}。想做什么就做，不想做也行。）`",
    "      if (agent) {",
    "        await host.wake(agent, injectMessage(text, { mode: 'contact', reason: '请求有回音' }))",
    "      } else {",
    "        // 会话没开着：写进待送，下次打开时补投",
    "        c.store.appendOutbox({ id: crypto.randomUUID(), ts: Date.now(), text, channel: 'dsm-session', delivered: false, wake: { mode: 'contact', reason: '请求有回音' } })",
    "      }",
  ].join('\n')
  if (!t.includes(old)) { console.log('answer block not found'); }
  else t = t.replace(old, neu)
  fs.writeFileSync(p, t)
  console.log('answer outbox', t.includes('appendOutbox'))
}
