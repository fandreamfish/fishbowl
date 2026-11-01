# fishbowl · DSH 集成接口清单 v0.1

> 本文档的接口名来自**本机安装的 DSH 0.2.1-rc.3**（从 `app.asar` 内的包源码与 README 提取，
> 缓存于 `.inspect/`，可删）。
> 文档与代码可能有偏差——**写插件前**，在 Creator 模式的 DSH 会话里用
> `cordis_inspect_list` / `cordis_inspect_query`（Service、Event）对运行实例复核一次。

---

## 1. 结论先行

我们需要的每一个能力，宿主都有现成接口，**没有任何一个需要 hack**：

| 我们要的能力 | DSH 接口（已核实） | 用法 |
|---|---|---|
| 采集一轮对话 | 会话日志事件 `turn/end`、`assistant/message`、`tool/result` | 轻量订阅 `session/event`，按 type 过滤，不做重扫 |
| 每轮注入状态 | `agent.inject()` | 以 user-role 消息落进下一步（记为 `agent/inbox/spliced`），不唤醒 agent |
| 拒绝 / 降低配合 | `ctx.tools.guard()`、`ctx.tools.restrict()` | guard 同步、单调；restrict 按 agent 收窄工具集 |
| “动手前先验证” | `tools/pre-execute` 瀑布返回 `ask` | 异步决策的官方通道 |
| 主动联系 | `agent.followup({ content, source: { kind: 'user' } })` | 以用户身份消息入队并唤醒 driver |
| 系统提示 | `ctx.systemPrompt.section()` / `variable()` | 只放**事实性**状态摘要，不放情绪文本 |
| 插件配置 | `export const Config`（Schemastery） | 用户改 `cordis.patch.yml`，升级不丢 |
| 插件 UI | `ctx.slots.inject` / `register` | M2 以后才做 |

一个重要的确认：**`agent.followup()` 支持 `source: { kind: 'user' }`**，
且宿主文档明确说它“以受识别的 user-role 消息进入会话”——
这回答了上一轮的问题：云端把消息投递进本地会话，**可以做，且是原生行为**。

---

## 2. 一轮对话的时间轴与我们的钩子

```
用户输入
  │  （进 inbox）
  ▼
agent/pre-step         ◄── 注入点：不在此处注入；此处只允许 reject / 替换消息
  ▼
step/start
  ▼
agent/request          ◄── 不能改请求消息
  ▼
system-prompt/assemble ◄── 注入点（事实摘要）：systemPrompt.section / variable
  ▼
LLM 请求
  │
agent/assistant-stream （实时帧，仅展示）
  ▼
assistant/message      （提交为日志事件）
  ▼
tool/call ──▶ tools/pre-execute  ◄── 钩子：ask / deny（验证门槛、拒绝阈值在这里落地）
  │              tools/execute
  │              tools/result
  │              tools/post-execute
  ▼
turn/end               ◄── 收集点：此时做异步评价 → affect → bias
  ▼
下一轮 agent/pre-step 之前：agent.inject() 送入上轮沉淀的状态
```

**因果方向是刻意的**：本轮的 `bias` 由**上一轮及更早**的事件算出。
这一轮的情绪不参与这一轮的判断——人也做不到，这既是成本优化（评价异步、不阻塞回复），也是真实性要求。

---

## 3. 已验证的 API 面

### 3.1 Agent（`@deepseek-ai/dsh-agent`）

```text
ctx.agents.create({ sessionId, agentOptions }) → AgentHandle
ctx.agents.resume(...) / get(id) / list() / roots()
handle.dispose()                              // 唯一能拆 agent 的对象

agent.followup({ content: [{type:'text',text}], source: {kind:'user'} })  // 唤醒
agent.steer({ content, source })              // 下一步输入，唤醒
agent.inject(content)                         // 模型可见上下文，不唤醒
agent.cancel(cause, { keepInbox })            // 默认清 inbox
await agent.whenIdle()                        // 到达静默

agent.ctx                                     // 该 agent 的作用域上下文：
                                              // 工具、提示段、变量、监听器、限制都只作用于它
```

事件：`agent/pre-step`、`agent/request`、`agent/request-error`、`agent/turn-stopping`、
`agent/assistant-stream`、`agent/status`、`agent/created`、`agent/disposed`、
`agent/inbox/inserted|claimed|discarded`、`agent/inbox/spliced`（落盘 fold）。

`agent/pre-step` 的决策形状：`{ kind: 'reject' }` 或
`{ kind: 'enter', messages, startsRequestSeries? }`。重写时必须 spread 原决策。

### 3.2 工具（`@deepseek-ai/dsh-tools`）

```text
ctx.tools.register(defineTool({...}))     // 注册工具（我们不注册新工具，除非做「自省」工具）
ctx.tools.restrict(filter)                // 每 agent 的 allow/deny 掩码，交集生效
ctx.tools.guard(guard)                    // 同步、单调拒绝；后到者不能翻案
ctx.tools.get(name, scope) / schemas(scope)
```

事件：`tools/pre-execute`（allow/deny/**ask**）、`tools/execute`、`tools/post-execute`、
`tools/result`（冻结的最终结果，观察用）、`tools/change`。

### 3.3 系统提示（`@deepseek-ai/dsh-system-prompt`）

```text
ctx.systemPrompt.section({ name, order, text })
ctx.systemPrompt.variable(name, provider)          // 每次装配时解析
ctx.systemPrompt.getSectionOrder(name) / getContextOrder(name)
```

配置里有 `personaPrefix` / `personaSuffix` —— 这是宿主的**部署级 persona 槽**，
正好是我们在第 1 条里要避免的“设定式人格”。**不用它**。

### 3.4 会话（`@deepseek-ai/dsh-session`）

```text
ctx.sessions.create(sessionId, {meta}) / get / list / fork / flush
session.append(type, data, opts)           // 只接受已知 type
session.deriveMessages()                   // 派生模型历史
session.seq / session.eventAt(seq)         // 只读访问（eventAt 替代已弃用的 snapshotEvents）
ctx.sessions.registerMessageProjection()   // 插件声明内容型事件（M2 以后考虑）
ctx.sessionProjections                     // 纯函数折叠：apply(state,event) / stateOf() / view()
```

落盘事件类型（`KNOWN_SESSION_EVENT_TYPES` 摘要）：
`turn/start` `turn/end` `step/start` `step/end` `user/message` `assistant/message`
`assistant/attempt` `tool/call` `tool/result` `llm/retry*` `session/title*` `workspace/changes` 等。

### 3.5 检查工具（`@deepseek-ai/dsh-tool-cordis`，Creator 模式）

`cordis_inspect_list`：列出 Host/Client provider；
`cordis_inspect_query`：查某个 provider 的精确方法与类型（`Service`、`Event`）。

---

## 4. 宿主硬约束（违反即坏）

1. **会话日志是唯一真相。** 模型看到的一切必须能从日志重建。我们的状态摘要必须走
   `agent.inject()`（会被记为 `agent/inbox/spliced`），不能有“日志外”的模型输入。
2. **禁止自定义事件类型。** 未知 type 的存储事件会让会话无法重开。
   `appendPluginRecord()` 保留给官方 experimental 包，外部插件明确不许用。
   → 我们的记忆、情绪、倾向**全部存自己的目录**，不进会话日志。
3. **guard 同步、单调**；需要 await 的决策（如“问问用户”）必须走 `tools/pre-execute` 返回 `ask`。
4. **瀑布监听器不拥有决策必须 `return next()`**，否则会断掉整条链上其他插件。
5. `agent/created` 监听器里**不能 `await whenIdle()`**（会死锁创建流程）。
6. 注册在 `agent.ctx` 上的东西，插件卸载时不会自动清理——**双 owner**：在插件自己的
   `ctx.effect` 里也持有 disposer。
7. 插件卸载与 agent 销毁都必须完整清理注册（`ctx.effect` / `ctx.on` 返回 cleanup）。
8. 插件贡献的 user message 若与别人合并，`source` 只有一个——所以我们用独立的 inject 消息，不与人合并。

---

## 5. M1 精确范围

### 做

- 单 profile、单会话、单个体，全部状态在 `$DSH_HOME/fishbowl/creatures/<id>/`（自己的目录）
- 收集：订阅 `session/event`，过滤 `turn/end`（含 `assistant/message`、`tool/result` 的上下文）→ 组装 episode
- 评价：轮次结束后**异步**一次 LLM 调用（结构化输出：7 维 appraisal + salience）→ `affect → bias`
- 注入：下一轮开始时 `agent.inject()` 送入**结构化状态摘要**
  （当前 bias 数值 + 一条最相关的教训 + 未完成承诺；不写“你现在有点难过”）
- 约束通道：`ctx.tools.guard()` 实现拒绝底线；`tools/pre-execute` 实现“验证门槛”（返回 `ask`）
- 纯函数层全部沿用原型参数（`legacy/prototype/engine.py` 已校准的数值）

### 不做（M2 以后）

- 巩固（真 LLM 归纳语义/教训）、议程、主动联系、UI、多个体、封存
- 云部署、QQ、本地代理、模型 pin 检查（M1 假设环境不变）

### A/B 验证（M1 的验收）

- 同一套剧本（5–8 个场景 × 3–6 轮，含被否定/被催/违诺/缺席重逢）
- 对照组：bias 恒 0.5、注入空状态；实验组：真 bias + 真状态
- 自动指标：工具调用数、`ask`/拒绝次数、回复长度、追问用户次数
- 人工盲评：两版回复混排，判断行为是否有别、是否只是措辞差异
- **通过标准**：≥3 个场景出现自动指标差异，且盲评认可“是行为变了”
- 不通过：问题在评价器与映射，**停下来修数值，不加新机制**

---

## 6. 插件骨架（来自 host-plugin.md，v0.1 占位）

```jsonc
// package.json
{
  "name": "@local/fishbowl",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./index.js" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

```yaml
# cordis.patch.yml
- insert:
    - id: fishbowl
      name: '@local/fishbowl'
      config: {}
```

```js
// index.js —— 三种导出形式之一，不混用
export function apply(ctx, config) {
  // 所有注册用 ctx.effect / ctx.on，返回 cleanup
}
export const inject = ['tools']          // 可选依赖声明，缺失时不激活
export const Config = Schema.object({    // Schemastery，用户可在 patch 层改
  growth: Schema.number().default(1.0),
  /* … */
})
```

安装：Plugin Manager 的 `install_bundle`（本地目录安装会链接 checkout，改代码走 HMR）；
或 `dsh plugin --profile <name> <pnpm args>`。观察激活结果时区分
`failed` / `overridden` / `restart-required` 三种状态。

---

## 7. 部署形态（本机 → 云端）

已从安装包确认：

| 命令 | 形态 |
|---|---|
| `dsh web` | Web profile，常驻服务——**云端形态** |
| `dsh --profile headless "job"` | 单次无头运行一个持久会话，跑完退出 |
| `dsh plugin --profile <name> …` | 管理某个 profile 的插件 |

- profile 目录：`$DSH_HOME/profiles/<name>/`，含 `package.json`（`dsh.profile.bundles` 有序列表）+ `cordis.patch.yml`（用户补丁层，升级保留）
- `--dump-config` / `--dump-config-schema` 可在不启动的情况下检查组合树
- 同一插件代码本地、云端各装一份；阶段 2 时云端为权威、本地为代理（见 DESIGN.md §15）

---

## 8. 写代码前要复核的开放问题

1. 在 Creator 模式会话跑 `cordis_inspect_query`，复核上面每个 Service / Event 名与签名
2. 插件自有数据的落点：宿主建议走 storage service（`dsh-storage` 系），
   但我们为了可搬迁更想要 `$DSH_HOME/fishbowl/creatures/` 明文目录——核实两者成本后定
3. 评价用的 LLM 调用：走宿主的 llm service 还是插件直接调 API（密钥怎么取）？
   初版倾向直接调，与宿主解耦，但会绕开宿主的计量与重试
4. ~~`agent.inject()` 的 content 格式~~ → **已实证**：必须是完整的 `user/message` 形状
   `{ role: 'user', id: <uuid>, content: [{type:'text',text}], source: {...} }`；
   缺 `role`/`id` 会把坏消息写进会话日志，该会话所有 API 请求 422 卡死（2026-10-30 事故，已修复并加回归测试）。
   另：宿主（Electron）内 import `.ts` 可用——Node 24 类型剥离在宿主内生效。
5. `tools/pre-execute` 返回 `ask` 的确切形状与用户侧呈现
6. 定时器注册点（M2 主动联系才需要）；注意 initiator scope 是 process-local
7. 若用 `systemPrompt` 的 context provider（`refreshContext`）替代 inject 放“每轮变化的状态”，
   语义与 inject 的差异（谁进日志、谁进 KV cache）

## 0.2.1-rc.5 适配（2026-10-31）

- **`tools.guard` 语义变更**：只有返回 `undefined` 是放行；返回 `null` 会被当成"拒绝，理由 null"，
  整条工具调用变成 `Error: null`。我们的 `refuseReason` 返回 `string | null`，钩子里必须过
  `guardVerdict()` 归一成 `undefined`。（症状：插件启用后所有工具全灭。）
- **profile 的 `dsh.profile.bundles` 决定激活**：升级后 fishbowl 不在列表里 → 插件根本没加载
  （路由 404）。补回列表末尾即可（HMR 热生效，无需重启）。
- **新清单要求**：`exports['./icon']` + `icon.svg` + `files` + `description` + `locale/*.json`
  （设置页/插件页读取标题与描述）。
- 新增插件管理器（`plugin_manager` 工具 / 侧栏插件页），启停写 `cordis.patch.yml` 的 `disabled`。
- 接口核对：`session/event`、`agent.inject/followup`、`systemPrompt.section`、
  `webServer.register`、客户端 `settings.section` 均未变；会话目录编码（分隔符折叠为 `-`、`~XXXX` 转义）
  也未变，工作区枚举仍可用。