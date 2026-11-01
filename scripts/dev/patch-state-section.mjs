import fs from 'node:fs'

// host: 动态系统提示段
{
  const p = 'packages/adapter-dsh/src/host.js'
  let t = fs.readFileSync(p, 'utf8')
  if (!t.includes('stateSection(agent')) {
    t = t.replace("    voice(agent, text) {", "    /** 动态状态段：每次组装提示词时现算，不再往 inbox 里塞消息。 */\n    stateSection(agent, build) {\n      try {\n        agent.ctx?.systemPrompt?.section?.({\n          name: 'fishbowl-state',\n          order: 450,\n          text: (context) => {\n            try { return String(build(context) ?? '') } catch { return '' }\n          },\n        })\n      } catch { /* 注册失败不影响对话 */ }\n    },\n\n    voice(agent, text) {")
  }
  fs.writeFileSync(p, t)
  console.log('host', t.includes('stateSection(agent'))
}

// turn.js: 改成动态段，删掉注入
{
  const p = 'packages/app/src/turn.js'
  let t = fs.readFileSync(p, 'utf8')

  // 用 buildStateText 替换 injectState 里组装部分的函数
  const start = t.indexOf('  async function injectState(session) {')
  const endMark = '\n  }\n\n  const offEvent = host.onSessionEvent'
  const end = t.indexOf(endMark, start)
  if (start < 0 || end < 0) { console.log('injectState not found', start, end) } else {
    const fn = [
      '  /** 组装状态块文本（每次组装提示词时现算）。 */',
      '  function buildStateText(session) {',
      '    try {',
      '      if (cfg.control || !cfg.injectBias) return ""',
      '      if (!session) return ""',
      '      const creature = binding.resolve({ sessionId: session.id, workspace: workspaceOf(session) })',
      '      if (!creature) return ""',
      '      const mem = memoryFor(creature)',
      '      const affect = creature.affectNow ? creature.affectNow() : creature.fold().affect',
      '      const bias = toBias(affect, creature.temperament)',
      '      const commitments = creature.openCommitments(configFor(cfg, creature).growth).slice(-2).map((x) => (x.broken ? "⚠ " : "") + x.text)',
      '      const snap = mem.render({ affect, bias, name: creature.meta.name, commitments, now: Date.now() })',
      '      injectedBy.set(session.id, snap.picked)',
      '      const grant = grantLine(creature)',
      '      const recent = recentBlock(recentDialog(creature, 6))',
      '      const req = creature.requestDigest()',
      '      const reqLines = []',
      '      if (req.pending.length) reqLines.push(`还在等回音: ${req.pending.join("；")}`)',
      '      if (req.answered.length) reqLines.push(`他答过的: ${req.answered.map((r) => `${r.text}（${r.answer === "yes" ? "同意" : "不同意"}）`).join("；")}`)',
      '      const reqText = reqLines.length ? "\\n" + reqLines.join("\\n") : ""',
      '      const perm = permitLine(creature)',
      '      const breach = breachLine(creature)',
      '      const extra = (perm ? `\\n你现在被允许: ${perm}` : "") + (breach ? `\\n${breach}` : "")',
      '      return snap.text + (grant ? `\\n他允许你的事: ${grant}` : "") + reqText + extra + (recent ? "\\n" + recent : "")',
      '    } catch (err) {',
      '      trace({ ts: Date.now(), sessionId: session?.id, warn: `state build failed: ${String(err?.message || err)}` })',
      '      return ""',
      '    }',
      '  }',
      '',
    ].join('\n')
    t = t.slice(0, start) + fn + t.slice(end + 1)
  }

  // 去掉 turn/start 注入
  t = t.replace("      } else if (t === 'turn/start') {\n        // 让本次 append 先发布完，再注入（否则会撞上 reenter）\n        setTimeout(() => { void injectState(session) }, 0)\n      } else if (t === 'turn/end') {", "      } else if (t === 'turn/end') {")

  // setupAgent 里注册动态段
  t = t.replace("      host.voice(agent, voiceRulesFor(configFor(cfg, creature).relation?.kind) + seedLine + dataLine)", "      host.voice(agent, voiceRulesFor(configFor(cfg, creature).relation?.kind) + seedLine + dataLine)\n      host.stateSection?.(agent, (context) => buildStateText(context?.agent?.session ?? agent?.session ?? { id: sid }))")

  fs.writeFileSync(p, t)
  console.log('turn', t.includes('buildStateText'), t.includes('turn/start'))
}
