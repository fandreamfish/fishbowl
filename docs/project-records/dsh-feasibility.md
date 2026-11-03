# DSH 接入 Fish：只读可行性调查

> 2026-11-03 更新：当前本机可访问 CLI 0.2.1-rc.2 和桌面安装包 0.2.1-rc.5。已运行真实 CLI Agent/Tool 内核加脚本模型的实验探针，五个场景通过。证据、版本差异和未验证项见 [dsh-task-validation.md](dsh-task-validation.md)。以下早期环境描述仅作为调查历史，不代表本轮环境。

## 当前目标：DSH 作为任务执行端

DSH 操作是 Fish 的一项外部能力，与 QQ 消息对接能力独立。以下 QQ 代码修改验收只是能力组合示例，不要求每条 QQ 消息调用 DSH，也不限定 DSH 只能由 QQ 入口触发。能力调用关系与物理连接方向分别设计。

首期不验证“拦截 DSH 用户输入、阻止原模型请求、回灌 Fishbowl assistant 输出”的替代模型闭环。目标改为：DSH Control Plugin 主动连接 Fishbowl，Fishbowl 发送任务请求，DSH 将任务交给自己的 Agent/Session/Tool 执行，执行过程完全由 DSH 掌控，最后只回传结果或错误。Fishbowl 不接收 DSH 的中间思考、工具调用和进度事件。

推荐连接模型为 DSH 插件主动建立持久 WebSocket 连接。WebSocket 的建连方向是 DSH → Fishbowl，但消息方向是双向的，因此 Fishbowl 可以通过已建立的连接下发任务，无需让 Fishbowl 连接 DSH 入站端口。

首个验收应包括：QQ → Fishbowl → DSH 任务请求、DSH 内部完成一次代码修改任务、最终结果回传 QQ、断线/超时/重复请求处理和 trace 关联。

状态：静态调查完成；没有运行 DSH，没有实现探针或修改业务代码。

## 本次实际检查

- PLUGIN.md：旧版 DSH 接口调查，主要覆盖 0.2.1-rc.3 与 rc.5。
- docs/HOST.md：本项目宿主契约。
- packages/adapter-dsh/src/host.js：当前适配器实现。
- scripts/：未发现实现替代模型 Provider 或提交外部 assistant 输出的探针。
- docs/STATE.md 所记载的 DSH 安装路径不可访问；环境中没有可调用的 dsh 命令。

## 当前任务模型的证据与限制

现有 host.js 的 wake 使用 agent.followup，说明仓库已有向 DSH Agent 投入消息的适配路径；onSessionEvent 说明已有会话事件监听路径。它们是任务提交与完成识别的候选基础，尚不能证明外部任务与最终回复可稳定一一对应。不能把 whenIdle 或任意 assistant/message 直接当作任务成功。

需要实际核实：绑定会话提交、接收确认、任务与回合关联、最终结束判断、错误/取消、去重持久化、断线重投和重启恢复。只在插件内部监听执行事件以识别最终结果，不向 Fish 转发内部事件。验收规则见 task-execution-rules.md。

## 历史调查：替代 DSH 模型（已退出首期）

以下证据表和三条接入路线只保留调查历史，不作为当前任务执行方案或门槛。

| 能力 | 证据 | 能证明什么 | 不能证明什么 |
|---|---|---|---|
| 监听会话事件 | host.js onSessionEvent；PLUGIN.md | 可接收会话事件 | 不证明可阻止模型请求 |
| pre-step 拒绝 | PLUGIN.md 的 reject/enter 说明 | 文档记录了请求前拒绝机制 | 未实测；不证明能替换模型结果 |
| agent/request | PLUGIN.md 标注不能修改消息 | 可作为观察线索 | 不能假定是响应替换钩子 |
| inject | host.js inject；PLUGIN.md | 注入下一步输入，不唤醒 | 不是 assistant 最终输出提交接口 |
| followup | host.js wake；PLUGIN.md | 输入并唤醒 Agent | 可能继续触发 DSH 模型，不符合独立替代目标 |
| 工具注册与 guard | host.js | 已有注册、限制钩子 | 不证明插件能代外部 Agent 完整调用工具 |
| 自定义模型 Provider | 本仓库无充分证据 | 候选路线 | 注册方式、流式协议与取消未核实 |
| 外部 assistant 提交 | 文档提及 session.append 与已知事件类型 | 值得查验 | 未证明能维护完整回合、投影和 UI 状态 |

### 历史三条候选接入路线

1. **外部 Agent 后端扩展**：若 DSH 官方允许插件接管完整回合，可由 Fish 拥有唯一 Agent loop，插件转换输入、输出流、取消及工具请求。最契合需求，但目前无证据证明接口存在。
2. **模型 Provider 代理**：若 DSH 支持插件注册自定义 Provider，可将 DSH 模型请求转到 Fish，不访问真实 DSH 模型端点。这通常有利于沿用 UI 流式显示，但必须规定 loop 所有权。Fish 若负责工具循环，DSH 不能再次执行相同工具；Provider 能否维持原生工具卡片仍待验证。不能把网络模型兼容性等同于完整外部 Agent 兼容性。
3. **请求前拦截 + 外部结果提交**：要求同时支持停止原回合、合法提交 assistant 输出、工具/流事件及结束状态。现有 inject/followup 不能代替这些接口。不能只靠 append 某条事件就宣称闭环成立。

历史传输候选曾包括 HTTP 长轮询、SSE+POST 和 WebSocket。当前首选插件主动建立 WebSocket，连接方向与 Fish 下发任务的方向独立。

## 当前结论

当前目标是把 DSH 作为独立任务执行能力。已实测 CLI rc.2 内核的消息投递、工具循环、结束、取消与消息/回合关联；桌面 rc.5 完成只读源码核对。Fish/插件完整协议、真实模型和可靠恢复尚未验证。独立 Fish Agent、QQ 接入与 DSH 操作能力分别设计。

下一步依据验证记录设计最小任务协议与适配器状态机，并补桌面 rc.5 激活、真实模型、接受/结果确认及恢复验证。DSH 可使用自己的模型和工具；Fish 不需要替代它的模型或显示内部过程。
