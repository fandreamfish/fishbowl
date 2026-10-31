/**
 * fishbowl 设置页（client half，M5）
 * 通过 settings.section 槽位挂到「设置」侧栏，与 dsh-pet 同款机制。
 * 数据来自同源路由 /fishbowl-ui/{state,config}（宿主插件注册）。
 */
function makeFactory() {
  return (require) => {
    const module = { exports: {} }
    const react = require('react')
    const { useState, useEffect, useCallback } = react
    const jsx = require('react/jsx-runtime').jsx

    /** 自动 runtime 的 jsx(type, props, key)：key 走第三参数，children 放 props。 */
    const e = (type, props, key) => (key === undefined ? jsx(type, props) : jsx(type, props, key))

    const API = '/fishbowl-ui'
    const box = { background: 'var(--dsw-alias-bg-2, rgba(127,127,127,0.07))', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }
    const rowS = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 }
    const lab = { fontSize: 13, color: 'var(--dsw-alias-text-2, #666)' }
    const inp = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--dsw-alias-border, #ddd)', background: 'var(--dsw-alias-bg-1, transparent)', color: 'inherit', font: 'inherit', fontSize: 13 }
    const btn = { padding: '7px 14px', borderRadius: 8, border: '1px solid var(--dsw-alias-border, #ddd)', background: 'var(--dsw-alias-bg-1, transparent)', color: 'inherit', cursor: 'pointer', font: 'inherit', fontSize: 13 }
    const btnP = { ...btn, background: 'var(--dsw-alias-brand, #4d6bfe)', borderColor: 'transparent', color: '#fff' }

    const getJson = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() }
    const postJson = async (u, b) => {
      const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
      if (!r.ok) throw new Error('HTTP ' + r.status)
      return r.json()
    }
    const fmt = (n) => Number(n ?? 0).toFixed(2)

    function CreatureCard(props) {
      const c = props.c
      const mem = c.memory || {}
      const lines = []
      if (mem.semantics?.length) lines.push('记得: ' + mem.semantics.join('；'))
      if (mem.procedures?.length) lines.push('教训: ' + mem.procedures.join('；'))
      if (mem.self?.length) lines.push('自我认知: ' + mem.self.join('；'))
      if (mem.commitments?.length) lines.push('承诺: ' + mem.commitments.join('；'))
      if (mem.activity) lines.push('一起在做: ' + mem.activity)
      return e('div', { style: box, children: [
        e('div', { style: rowS, children: [
          e('div', { style: { fontWeight: 600 }, children: (c.name || '（未命名）') + (c.frozen ? ' · 封存' : '') }),
          e('div', { style: { fontSize: 12, color: 'var(--dsw-alias-text-2, #666)' }, children: c.sessionId.slice(0, 18) + ' · ' + c.episodes + ' 轮' }),
        ] }, 'h'),
        e('div', { style: { fontSize: 12, ...lab, marginBottom: 6 }, children: '效价 ' + fmt(c.affect.v) + ' · 唤醒 ' + fmt(c.affect.a) + ' · 愧疚 ' + fmt(c.affect.guilt) + ' · 想念 ' + fmt(c.affect.longing) }, 'a'),
        lines.length
          ? e('div', { style: { fontSize: 12.5, lineHeight: 1.8 }, children: lines.map((l, i) => e('div', { children: l }, 'l' + i)) }, 'm')
          : e('div', { style: { fontSize: 12, ...lab }, children: '还没有记忆（聊几轮后开始巩固）' }, 'm'),
      ] }, props.k)
    }

    function Section() {
      const [state, setState] = useState(null)
      const [showLive, setShowLive] = useState(false)
      const [growth, setGrowth] = useState(1)
      const [seedName, setSeedName] = useState('')
      const [seedBg, setSeedBg] = useState('')
      const [msg, setMsg] = useState('')
      const [err, setErr] = useState('')

      const load = useCallback(async () => {
        try {
          const s = await getJson(API + '/state')
          setState(s)
          setGrowth(s.config.growth)
          setSeedName(s.config.seed?.name ?? '')
          setSeedBg(s.config.seed?.background ?? '')
          setErr('')
        } catch (x) { setErr(String((x && x.message) || x)) }
      }, [])
      useEffect(() => { void load() }, [load])
      useEffect(() => {
        if (!showLive) return
        const t = setInterval(() => { void load() }, 5000)
        return () => clearInterval(t)
      }, [showLive, load])

      const born = !!(state && state.born)
      const save = async () => {
        try {
          // 出生后来历只读（公理 A1）：只保存成长率
          const body = born ? { growth } : { growth, seed: { name: seedName, background: seedBg } }
          await postJson(API + '/config', body)
          setMsg(born ? '已保存：成长率即时生效' : '已保存：成长率即时生效；来历从新出生的个体开始生效')
          await load()
        } catch (x) { setErr(String((x && x.message) || x)) }
      }

      const creatures = (state && state.creatures) || []
      const live = creatures
        .reduce((acc, c) => acc.concat((c.events || []).map((ev) => ({ ...ev, who: c.name || c.sessionId.slice(0, 8) }))), [])
        .sort((a, b) => (b.ts || 0) - (a.ts || 0))
        .slice(0, 60)

      return e('div', { style: { fontSize: 13.5, lineHeight: 1.75 }, children: [
        e('div', { style: { fontWeight: 600, fontSize: 15, marginBottom: 4 }, children: 'fishbowl · 她' }, 'title'),
        e('div', { style: { ...lab, marginBottom: 12 }, children: '记忆、情绪、人格从对话里长出来。设定越具体，它自己长出来的东西越少。' }, 'desc'),
        err ? e('div', { style: { color: 'var(--dsw-alias-danger, #d33)', marginBottom: 8 }, children: err }, 'err') : null,
        e('div', { style: { fontWeight: 600, margin: '4px 0 8px' }, children: '实时状况' }, 's1'),
        ...(creatures.length
          ? creatures.map((c, i) => e(CreatureCard, { c, k: 'c' + i }))
          : [e('div', { style: box, children: '还没有个体：新开一个会话聊几句，她就会出生。' }, 'none')]),
        e('div', { style: rowS, children: [
          e('span', { style: lab, children: showLive ? '每 5 秒刷新中' : '点开查看她做过的所有事' }, 'l'),
          e('button', { style: btn, onClick: () => setShowLive((v) => !v), children: showLive ? '收起时间线' : '实时状况' }, 'b'),
        ] }, 'liverow'),
        showLive
          ? e('div', { style: box, children: live.length
              ? live.map((ev, i) => e('div', { style: { fontSize: 12.5, padding: '2px 0', borderBottom: '1px solid var(--dsw-alias-border, rgba(127,127,127,0.12))' }, children: '[' + ev.t + '] ' + ev.who + ': ' + (ev.text || '') }, 'e' + i))
              : e('div', { style: lab, children: '还没有事件' }) }, 'timeline')
          : null,
        e('div', { style: { fontWeight: 600, margin: '16px 0 8px' }, children: '初始状态 / 基础人设' }, 's2'),
        born ? e('div', { style: { ...lab, marginBottom: 8 }, children: '她已经出生了：来历只读（历史会被铭记，只能说服，不能修改）。想重新开始请新建会话。' }, 'bornhint') : null,
        e('div', { style: box, children: [
          e('div', { style: rowS, children: [
            e('span', { style: lab, children: '名字（新个体出生时使用）' }, 'l'),
            e('input', { style: { ...inp, width: 200, opacity: born ? 0.5 : 1 }, value: seedName, placeholder: '例：大肥鱼', disabled: born, onInput: (ev) => setSeedName(ev.target.value) }, 'i'),
          ] }, 'n'),
          e('div', { style: { ...lab, marginBottom: 6 }, children: '来历（一两句话；越具体，涌现越少）' }, 'l2'),
          e('textarea', { style: { ...inp, minHeight: 64, resize: 'vertical', opacity: born ? 0.5 : 1 }, value: seedBg, placeholder: '例：从水族馆来的鱼，喜欢猫和安静。', disabled: born, onInput: (ev) => setSeedBg(ev.target.value) }, 't'),
        ] }, 'f1'),
        e('div', { style: box, children: [
          e('div', { style: { ...rowS, marginBottom: 4 }, children: [
            e('span', { style: lab, children: '成长率' }, 'l'),
            e('span', { style: { fontSize: 12, color: 'var(--dsw-alias-text-2, #666)' }, children: growth.toFixed(2) + ' · 学得快也忘得快' }, 'v'),
          ] }, 'r'),
          e('input', { type: 'range', min: '0.25', max: '4', step: '0.05', value: growth, style: { width: '100%' }, onInput: (ev) => setGrowth(Number(ev.target.value)) }, 's'),
        ] }, 'f2'),
        e('div', { style: rowS, children: [
          e('span', { style: { ...lab, fontSize: 12 }, children: msg }, 'm'),
          e('button', { style: btnP, onClick: () => { void save() }, children: '保存' }, 'b'),
        ] }, 'act'),
      ] }, 'root')
    }

    const name = 'fishbowl'
    const inject = ['slots', 'locale']

    function apply(ctx) {
      ctx.slots.inject('settings.section', function* () {
        yield ctx.slots.register({
          name: 'settings.section',
          id: 'fishbowl-config',
          order: 31,
          label: () => 'fishbowl',
        }, Section)
      })
    }

    module.exports = { apply, inject, name }
    return module.exports
  }
}

window.__ModuleLoader__.load({ id: '@local/fishbowl', factory: makeFactory() })
