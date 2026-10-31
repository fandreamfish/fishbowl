# FishHost：宿主适配层

「鱼」的内核（`src/core/`）不依赖任何宿主。宿主只需要提供下面这些动词——
DSH 的实现见 `packages/plugin/host/dsh.js`，QQ 桥是一个更小的第二实现。

## 契约

```js
// 观察
onSessionEvent(fn)      // (session, event) => void：会话事件流（谁说了什么、一轮结束）
onAgentCreated(fn)      // (payload) => void：宿主建立一个可注入的上下文时

// 身份与投递
agentFor(sessionId)     // 活着的 agent（能注入/唤醒的那个），没有返回 null
inject(agent, message)  // 把状态块塞进下一步（不唤醒、不影响当前轮）
wake(agent, message)    // 主动开一轮
voice(agent, text)      // 注册该 agent 专属的系统提示段（声音规则）

// 工具（可选）
guard(fn)               // 单调工具拦截：返回 undefined 放行，返回字符串拒绝
preExecute(fn)          // 执行前询问：返回 { kind: 'ask', reason } 或 next()

// 命名（可选）
titleOf(scope)          // 当前标题（scope: {kind:'session'|'workspace', id}）
nameScope(scope, title) // 改名，返回 {ok, why}；会话通常只能改活着的

// 住处枚举
listScopes()            // { workspaces: string[], sessions: {id, workspace}[] }

// 宿主能力
registerRoute(route)    // 注册 HTTP 路由（设置页后端用）
stateDir                // 个体状态目录
```

## 写一个新宿主

1. 实现上面所有方法（可选的返回 `undefined` 即可）
2. 在入口把 host 传给四个模块：
   - `createCollector(ctx, binding, cfg, host)`
   - `createConstraints(ctx, binding, cfg, host)`
   - `createWakeLoop(ctx, binding, cfg, host)`
   - `createUiRoute(ctx, cfg, binding, host)`
3. 事件流只需要表达：用户说了什么、助手说了什么、工具调用了什么、一轮何时结束。

## 当前 DSH 接线（都在这一个文件里）

`host/dsh.js` 触碰的 DSH API：

| 动词 | DSH API |
|---|---|
| onSessionEvent / onAgentCreated | `ctx.on('session/event')` / `ctx.on('agent/created')` |
| agentFor | `ctx.agents.get/list` |
| inject / wake | `agent.inject` / `agent.followup` |
| voice | `agent.ctx.systemPrompt.section({name, order, text})` |
| guard / preExecute | `ctx.tools.guard` / `ctx.on('tools/pre-execute')` |
| titleOf / nameScope | `ctx.get('sessions')` + `ctx.get('sessionTitle')` / `ctx.get('workspaceRegistry')` |
| listScopes | `~/.dsh/sessions/<编码路径>/session-<id>` 目录布局 |
| registerRoute | `ctx.get('webServer').register` |

**升级 DSH 时只检查这一个文件。** 已经在 rc.5 踩过的坑：`guard` 只有 `undefined`
是放行（返回 null → `Error: null`）、会话标题只能改活着的会话、profile 的
`dsh.profile.bundles` 决定插件是否加载。
