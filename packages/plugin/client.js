/**
 * fishbowl 设置页（client half，M7）
 * 结构：鱼列表（卡片） → 单条鱼（页内分页：状态 / 住处 / 日记 / 小纸条 / 请求 / 人设）
 * 数据来自同源路由 /fishbowl-ui/*（宿主插件注册）。
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
    const lab = { fontSize: 12.5, color: 'var(--dsw-alias-text-2, #666)' }
    const inp = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--dsw-alias-border, #ddd)', background: 'var(--dsw-alias-bg-1, transparent)', color: 'inherit', font: 'inherit', fontSize: 13 }
    const btn = { padding: '6px 12px', borderRadius: 8, border: '1px solid var(--dsw-alias-border, #ddd)', background: 'var(--dsw-alias-bg-1, transparent)', color: 'inherit', cursor: 'pointer', font: 'inherit', fontSize: 12.5 }
    const btnP = { ...btn, background: 'var(--dsw-alias-brand, #4d6bfe)', borderColor: 'transparent', color: '#fff' }
    const btnS = { ...btn, fontSize: 12, padding: '4px 10px' }

    const getJson = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() }
    const postJson = async (u, b) => {
      const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.ok === false) throw new Error(j.error || ('HTTP ' + r.status))
      return j
    }
    const fmt = (n) => Number(n ?? 0).toFixed(2)
    const shortId = (id) => {
      const s = String(id || '')
      const m = s.match(/^session-([0-9a-f]{8})/i)
      if (m) return 'session-' + m[1] + '…'
      return s.length > 14 ? s.slice(0, 14) + '…' : s
    }
    const occText = (occ) => {
      if (!occ) return '未分配（不归任何会话）'
      if (occ.kind === 'workspace') return '工作区 ' + occ.id
      return '会话 ' + shortId(occ.id) + (occ.workspace ? '（' + (occ.workspace.split(/[\\\\/]/).filter(Boolean).pop() || '') + '）' : '')
    }

    function FishCard(props) {
      const f = props.f
      return e('div', {
        style: { ...box, cursor: 'pointer', border: '1px solid var(--dsw-alias-border, rgba(127,127,127,0.18))' },
        onClick: props.onOpen,
        children: [
          e('div', { style: rowS, children: [
            e('div', { style: { fontWeight: 600, fontSize: 14 }, children: f.name + (f.frozen ? ' · 封存' : '') }, 'n'),
            e('div', { style: { ...lab, fontSize: 11.5 }, children: f.episodes + ' 轮' }, 'e'),
          ] }, 'h'),
          e('div', { style: { ...lab, marginBottom: 6 }, children: occText(f.occupancy) }, 'o'),
          e('div', { style: { ...lab, marginBottom: 4 }, children: '效价 ' + fmt(f.affect.v) + ' · 唤醒 ' + fmt(f.affect.a) + ' · 愧疚 ' + fmt(f.affect.guilt) + ' · 想念 ' + fmt(f.affect.longing) }, 'a'),
          f.pendingRequests?.length
            ? e('div', { style: { fontSize: 12, color: 'var(--dsw-alias-warning, #b26a00)' }, children: '有 ' + f.pendingRequests.length + ' 个请求在等你回话' }, 'r')
            : null,
        ] }, props.k)
    }

    function Section() {
      const [data, setData] = useState(null)
      const [view, setView] = useState({ level: 'list' })
      const [err, setErr] = useState('')
      const [msg, setMsg] = useState('')
      const [growth, setGrowth] = useState(1)
      const [seedName, setSeedName] = useState('')
      const [seedBg, setSeedBg] = useState('')
      const [ws, setWs] = useState('')
      const [sess, setSess] = useState('')
      const [moveOpen, setMoveOpen] = useState(false)
      const [pick, setPick] = useState(null)
      const [pickWs, setPickWs] = useState(null)
      const [moveErr, setMoveErr] = useState('')

      const load = useCallback(async () => {
        try {
          const d = await getJson(API + '/fish')
          setData(d)
          setGrowth(d.config.growth)
          setSeedName(d.config.seed?.name ?? '')
          setSeedBg(d.config.seed?.background ?? '')
          setErr('')
        } catch (x) { setErr(String((x && x.message) || x)) }
      }, [])
      useEffect(() => { void load() }, [load])

      const fish = (data && data.fish) || []
      const selected = view.level === 'fish' ? fish.find((f) => f.id === view.id) : null
      const born = !!(data && data.born)

      const act = async (fn, okMsg) => {
        try { await fn(); setMsg(okMsg || ''); setErr(''); await load() }
        catch (x) { setErr(String((x && x.message) || x)); setMsg('') }
      }

      const openFish = (id) => { setView({ level: 'fish', id, page: 'home' }); setWs(''); setSess(''); setMsg(''); setMoveOpen(false); setPick(null) }

      // ---------- 列表 ----------
      if (view.level === 'list') {
        return e('div', { style: { fontSize: 13.5, lineHeight: 1.75 }, children: [
          e('div', { style: { fontWeight: 600, fontSize: 15, marginBottom: 4 }, children: 'fishbowl · 养的鱼' }, 't'),
          e('div', { style: { ...lab, marginBottom: 12 }, children: '每条鱼一个住处：一个工作区，或工作区里的某个会话。一个工作区只能住一条鱼。' }, 'd'),
          err ? e('div', { style: { color: 'var(--dsw-alias-danger, #d33)', marginBottom: 8 }, children: err }, 'err') : null,
          fish.length
            ? fish.map((f, i) => e(FishCard, { f, k: 'f' + i, onOpen: () => openFish(f.id) }))
            : e('div', { style: box, children: '还没有鱼。点下面「带一条新的回家」。' }, 'none'),
          e('div', { style: { ...rowS, marginTop: 8 }, children: [
            e('span', { style: lab, children: fish.length + ' 条' }, 'c'),
            e('button', { style: btnP, onClick: () => act(async () => { await postJson(API + '/fish', {}) }, '接回了一条新的') , children: '带一条新的回家' }),
          ] }, 'add'),
        ] }, 'root')
      }

      // ---------- 单条鱼 ----------
      if (!selected) return e('div', { style: box, children: '这条鱼不见了，回去重新看看。' }, 'gone')
      const f = selected
      const page = view.page || 'status'
      const setPage = (p) => setView({ ...view, page: p })
      const tabs = [
        ['status', '状态'], ['home', '住所'], ['persona', '人设'],
      ]

      let body = null
      if (page === 'status') {
        const mem = f.memory || {}
        const lines = []
        if (mem.semantics?.length) lines.push('记得: ' + mem.semantics.join('；'))
        if (mem.procedures?.length) lines.push('教训: ' + mem.procedures.join('；'))
        if (mem.self?.length) lines.push('自我认知: ' + mem.self.join('；'))
        if (mem.commitments?.length) lines.push('承诺: ' + mem.commitments.join('；'))
        if (mem.activity) lines.push('一起在做: ' + mem.activity)
        if (mem.folded) lines.push('记不清的旧事: ' + mem.folded + ' 件')
        body = e('div', { children: [
          e('div', { style: box, children: [
            e('div', { style: { ...lab, marginBottom: 4 }, children: occText(f.occupancy) }, 'o'),
            e('div', { style: lab, children: '效价 ' + fmt(f.affect.v) + ' · 唤醒 ' + fmt(f.affect.a) + ' · 愧疚 ' + fmt(f.affect.guilt) + ' · 想念 ' + fmt(f.affect.longing) + ' · ' + f.episodes + ' 轮' }, 'a'),
          ] }, 's'),
          e('div', { style: box, children: lines.length
            ? lines.map((l, i) => e('div', { style: { fontSize: 12.5, lineHeight: 1.8 }, children: l }, 'l' + i))
            : e('div', { style: lab, children: '还没有记忆（聊几轮后会开始巩固）' }) }, 'm'),
        ] }, 'status')
      } else if (page === 'home') {
        const workspaces = (data.scopes && data.scopes.workspaces) || []
        const sessions = (data.scopes && data.scopes.sessions) || []
        const occupiedWs = {}     // 整个屋子被占（workspace 级）
        const occupiedSess = {}   // 单个房间被占（session 级）
        const sessInWs = {}       // 屋子下有房间被占（只影响「整个屋子」那行）
        for (const g of fish) {
          const o = g.occupancy
          if (!o) continue
          if (o.kind === 'workspace') occupiedWs[o.id] = g.name
          else {
            occupiedSess[o.id] = g.name
            if (o.workspace) { sessInWs[o.workspace] = sessInWs[o.workspace] || []; sessInWs[o.workspace].push(g.name) }
          }
        }
        const base = (p) => (p ? (p.split(/[\\/]/).filter(Boolean).pop() || '') : '')
        const wsPath = f.occupancy ? (f.occupancy.kind === 'workspace' ? f.occupancy.id : (f.occupancy.workspace || '')) : ''
        const roomName = !f.occupancy ? '未分配' : f.occupancy.kind === 'workspace' ? '整个屋子（所有会话）' : f.occupancy.id

        const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }
        const modal = { background: 'var(--dsw-alias-bg-1, #fff)', color: 'var(--dsw-alias-text-1, #222)', borderRadius: 12, padding: 16, width: 620, maxWidth: '92vw', maxHeight: '72vh', overflow: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,0.25)' }
        const col = { flex: 1, minWidth: 0, border: '1px solid var(--dsw-alias-border, rgba(127,127,127,0.2))', borderRadius: 10, padding: 8, maxHeight: '44vh', overflow: 'auto' }
        const node = (label, disabled, active, onClick, key) => e('div', {
          key,
          style: {
            padding: '7px 9px', borderRadius: 8, marginBottom: 4, fontSize: 13,
            cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1,
            background: active ? 'var(--dsw-alias-bg-2, rgba(127,127,127,0.16))' : 'transparent',
            fontWeight: active ? 600 : 400, wordBreak: 'break-all',
          },
          onClick: () => { if (!disabled) onClick() },
          children: label,
        })
        const roomsOf = (w) => sessions.filter((s2) => (s2.workspace || '') === (w || ''))
        const wsBlocked = (w) => !!(occupiedWs[w] || sessInWs[w])
        const wsWhy = (w) => occupiedWs[w] ? '（' + occupiedWs[w] + ' 已住）' : sessInWs[w] ? '（有房间住着 ' + sessInWs[w][0] + '）' : ''

        const moveModal = moveOpen ? e('div', { style: overlay, onClick: () => { setMoveOpen(false); setPick(null); setPickWs(null); setMoveErr('') }, children: [
          e('div', { style: modal, onClick: (ev) => ev.stopPropagation(), children: [
            e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }, children: [
              e('div', { style: { fontWeight: 600, fontSize: 14 }, children: '搬家 · ' + f.name + '的房间' }, 't'),
              e('button', { style: { ...btnS, padding: '2px 9px' }, onClick: () => { setMoveOpen(false); setPick(null); setPickWs(null); setMoveErr('') }, children: '×' }, 'x'),
            ] }, 'hdr'),
            e('div', { style: { display: 'flex', gap: 8 }, children: [
              e('div', { style: col, children: [
                e('div', { style: { ...lab, marginBottom: 6 }, children: '屋子（工作区）' }, 'lw'),
                ...workspaces.map((w, i) => node(
                  (pickWs === w ? '▾ ' : '▸ ') + base(w) + wsWhy(w),
                  false,
                  pickWs === w,
                  () => { setPickWs(w); setPick(null); setMoveErr('') },
                  'w' + i)),
                !workspaces.length ? e('div', { style: lab, children: '还没有见过工作区' }, 'nows') : null,
              ] }, 'left'),
              e('div', { style: col, children: [
                e('div', { style: { ...lab, marginBottom: 6 }, children: '房间（会话）' }, 'lr'),
                pickWs
                  ? e('div', { children: [
                      node('整个屋子（所有会话）' + (wsBlocked(pickWs) ? wsWhy(pickWs) : (pick && pick.kind === 'workspace' ? '（已选）' : '')),
                        wsBlocked(pickWs),
                        !!(pick && pick.kind === 'workspace' && pick.id === pickWs),
                        () => { setPick({ kind: 'workspace', id: pickWs }); setMoveErr('') },
                        'all'),
                      ...roomsOf(pickWs).map((s2, i) => {
                        const taken = occupiedSess[s2.id]
                        const disabled = !!taken && taken !== f.name
                        const active = !!(pick && pick.kind === 'session' && pick.id === s2.id)
                        return node(shortId(s2.id) + (disabled ? '（' + taken + ' 已住）' : active ? '（已选）' : ''), disabled, active, () => { setPick({ kind: 'session', id: s2.id, workspace: s2.workspace }); setMoveErr('') }, 'r' + i)
                      }),
                      !roomsOf(pickWs).length ? e('div', { style: lab, children: '这个屋子还没有记录到的房间' }, 'norooms') : null,
                    ] }, 'rooms')
                  : e('div', { style: lab, children: '先点左边选一个屋子，这里会展开它的房间' }, 'pickfirst'),
              ] }, 'right'),
            ] }, 'cols'),
            moveErr ? e('div', { style: { color: 'var(--dsw-alias-danger, #d33)', fontSize: 12.5, marginTop: 10 }, children: moveErr }, 'merr') : null,
            e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }, children: [
              e('span', { style: { ...lab, fontSize: 12 }, children: pick ? '已选：' + (pick.kind === 'workspace' ? '整个屋子 ' + base(pick.id) : '房间 ' + shortId(pick.id)) : '还没选' }, 'sel'),
              e('div', { style: { display: 'flex', gap: 8 }, children: [
                e('button', { style: { ...btnS, padding: '5px 14px' }, onClick: () => { setMoveOpen(false); setPick(null); setPickWs(null); setMoveErr('') }, children: '取消' }, 'c'),
                e('button', { style: { ...btnP, opacity: pick ? 1 : 0.5, cursor: pick ? 'pointer' : 'not-allowed', fontSize: 13, padding: '6px 16px' }, onClick: async () => {
                  if (!pick) return
                  if ((pick.kind === 'workspace' && wsBlocked(pick.id)) || (pick.kind === 'session' && occupiedSess[pick.id] && occupiedSess[pick.id] !== f.name)) {
                    setMoveErr('这个住处已经住着「' + (pick.kind === 'workspace' ? (occupiedWs[pick.id] || (sessInWs[pick.id] || [])[0]) : occupiedSess[pick.id]) + '」了')
                    return
                  }
                  try {
                    await postJson(API + '/fish/' + f.id + '/occupy', { kind: pick.kind, id: pick.id, workspace: pick.workspace })
                    setMoveOpen(false); setPick(null); setPickWs(null); setMoveErr('')
                    await load()
                  } catch (x) { setMoveErr(String((x && x.message) || x)) }
                }, children: '入住' }, 'ok'),
              ] }, 'acts'),
            ] }, 'foot'),
          ] }, 'modal'),
        ] }) : null

        body = e('div', { children: [
          e('div', { style: box, children: [
            e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }, children: [
              e('div', { style: { fontWeight: 600, fontSize: 14 }, children: f.name + '的房间' }, 'rn'),
              e('div', { style: { display: 'flex', gap: 6 }, children: [
                e('button', { style: { ...btnS, fontSize: 12, padding: '3px 12px', fontWeight: 500 }, onClick: () => { setMoveOpen(true); setPick(null); setPickWs(null); setMoveErr('') }, children: '搬家' }),
                f.occupancy ? e('button', { style: { ...btnS, fontSize: 12, padding: '3px 12px', fontWeight: 400, color: 'var(--dsw-alias-text-2, #666)' }, onClick: () => act(async () => { await postJson(API + '/fish/' + f.id + '/release') }, '搬出来了'), children: '搬出' }) : null,
              ] }, 'btns'),
            ] }, 'head'),
            e('div', { style: { display: 'grid', gridTemplateColumns: '52px 1fr', rowGap: 4, fontSize: 12.5, marginBottom: 4 }, children: [
              e('div', { style: { color: 'var(--dsw-alias-text-3, #999)' }, children: '屋子' }, 'wl'),
              e('div', { style: { wordBreak: 'break-all' }, children: wsPath ? base(wsPath) : '—' }, 'wv'),
              e('div', { style: { color: 'var(--dsw-alias-text-3, #999)' }, children: '房间' }, 'rl'),
              e('div', { style: { wordBreak: 'break-all' }, children: (roomName === '整个屋子（所有会话）' || roomName === '未分配') ? roomName : shortId(roomName) }, 'rv'),
            ] }, 'occ'),
            e('div', { style: { ...lab, fontSize: 12 }, children: f.episodes + ' 轮 · 身份文件 ' + (f.metaBytes || 0) + ' 字节' }, 'meta'),
          ] }, 'room'),
          moveModal,
          e('div', { style: box, children: [
            e('div', { style: { fontWeight: 600, fontSize: 13.5, marginBottom: 6 }, children: '她的请求' }, 'reqh'),
            e('div', { style: { ...lab, marginBottom: 8 }, children: '她有事想征求你同意时会提请求。一天最多一次，一周最多三次；没答的可以在这里补答。' }, 'reqhint'),
            (f.requests || []).length
              ? f.requests.map((r, i) => e('div', { key: 'r' + i, style: { marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid var(--dsw-alias-border, rgba(127,127,127,0.12))' }, children: [
                  e('div', { style: { fontSize: 13 }, children: r.text }, 'tx'),
                  r.answer === null
                    ? e('div', { style: { display: 'flex', gap: 8, marginTop: 6 }, children: [
                        e('button', { style: btnS, onClick: () => act(async () => { await postJson(API + '/fish/' + f.id + '/requests/' + r.id + '/answer', { answer: 'yes' }) }, '答应了'), children: '同意' }),
                        e('button', { style: btnS, onClick: () => act(async () => { await postJson(API + '/fish/' + f.id + '/requests/' + r.id + '/answer', { answer: 'no' }) }, '拒绝了'), children: '不同意' }),
                      ] }, 'ans')
                    : e('div', { style: { ...lab, marginTop: 4 }, children: r.answer === 'yes' ? '已同意' : '已拒绝' }, 'done'),
                ] }, 'r'))
              : e('div', { style: lab, children: '现在没有等你答的' }),
          ] }, 'req'),
          e('div', { style: box, children: [
            e('div', { style: { fontWeight: 600, fontSize: 13.5, marginBottom: 6 }, children: '日记' }, 'diaryh'),
            e('div', { style: { ...lab, marginBottom: 8 }, children: '每天一篇，写下今天发生的事和心情。多天的日记会攒在这里。' }, 'diaryhint'),
            (f.diary || []).length
              ? f.diary.map((d, i) => e('div', { style: { marginBottom: 10 }, children: [
                  e('div', { style: { ...lab, marginBottom: 2 }, children: d.date }, 'dt'),
                  e('div', { style: { fontSize: 13, whiteSpace: 'pre-wrap' }, children: d.text }, 'tx'),
                ] }, 'd' + i))
              : e('div', { style: lab, children: '还没写过日记' }),
          ] }, 'diary'),
          e('div', { style: box, children: [
            e('div', { style: { fontWeight: 600, fontSize: 13.5, marginBottom: 6 }, children: '小纸条' }, 'noteh'),
            e('div', { style: { ...lab, marginBottom: 8 }, children: '特意留给你的话，代表她当前的状态，可能藏着关键信息。' }, 'notehint'),
            (f.notes || []).length
              ? f.notes.map((n, i) => e('div', { style: { marginBottom: 8, fontSize: 13 }, children: '「' + n.text + '」' }, 'n' + i))
              : e('div', { style: lab, children: '还没有小纸条' }),
          ] }, 'notes'),
        ] }, 'home-root')      } else if (page === 'persona') {
        body = e('div', { children: [
          born ? e('div', { style: { ...lab, marginBottom: 8 }, children: '她已经出生了：来历只读（历史会被铭记，只能说服，不能修改）。' }, 'born') : null,
          e('div', { style: box, children: [
            e('div', { style: rowS, children: [
              e('span', { style: lab, children: '名字（新鱼出生时使用）' }, 'l'),
              e('input', { style: { ...inp, width: 200, opacity: born ? 0.5 : 1 }, value: seedName, disabled: born, onInput: (ev) => setSeedName(ev.target.value) }, 'i'),
            ] }, 'n'),
            e('div', { style: { ...lab, marginBottom: 6 }, children: '来历（一两句话；越具体，涌现越少）' }, 'l2'),
            e('textarea', { style: { ...inp, minHeight: 64, resize: 'vertical', opacity: born ? 0.5 : 1 }, value: seedBg, disabled: born, onInput: (ev) => setSeedBg(ev.target.value) }, 't'),
          ] }, 'seed'),
          e('div', { style: box, children: [
            e('div', { style: { ...rowS, marginBottom: 4 }, children: [
              e('span', { style: lab, children: '成长率' }, 'l'),
              e('span', { style: { fontSize: 12, color: 'var(--dsw-alias-text-2, #666)' }, children: growth.toFixed(2) + ' · 学得快也忘得快' }, 'v'),
            ] }, 'r'),
            e('input', { type: 'range', min: '0.25', max: '4', step: '0.05', value: growth, style: { width: '100%' }, onInput: (ev) => setGrowth(Number(ev.target.value)) }, 's'),
          ] }, 'growth'),
          e('div', { style: rowS, children: [
            e('span', { style: { ...lab, fontSize: 12 }, children: msg }, 'm'),
            e('button', { style: btnP, onClick: () => act(async () => {
              const body2 = born ? { growth } : { growth, seed: { name: seedName, background: seedBg } }
              await postJson(API + '/config', body2)
            }, born ? '成长率已保存' : '已保存：来历从新出生的鱼开始生效'), children: '保存' }),
          ] }, 'act'),
        ] }, 'persona')
      }

      return e('div', { style: { fontSize: 13.5, lineHeight: 1.75 }, children: [
        e('div', { style: { ...rowS, marginBottom: 8 }, children: [
          e('div', { style: { fontWeight: 600, fontSize: 15 }, children: f.name }, 'n'),
          e('button', { style: btnS, onClick: () => setView({ level: 'list' }) , children: '← 所有鱼' }),
        ] }, 'hdr'),
        e('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }, children: tabs.map(([id, label]) =>
          e('button', { key: id, style: id === page ? { ...btnS, background: 'var(--dsw-alias-bg-2, rgba(127,127,127,0.14))', fontWeight: 600 } : btnS, onClick: () => setPage(id) , children: label })) }, 'tabs'),
        err ? e('div', { style: { color: 'var(--dsw-alias-danger, #d33)', marginBottom: 8 }, children: err }, 'err') : null,
        body,
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
