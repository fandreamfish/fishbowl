# DSH 接入 Fish：只读可行性调查

状态：静态调查完成；没有运行 DSH，没有实现探针或修改业务代码。

## 本次实际检查

- PLUGIN.md：旧版 DSH 接口调查，主要覆盖 0.2.1-rc.3 与 rc.5。
- docs/HOST.md：本项目宿主契约。
- packages/adapter-dsh/src/host.js：当前适配器实现。
- scripts/：未发现实现替代模型 Provider 或提交外部 assistant 输出的探针。
- docs/STATE.md 所记载的 DSH 安装路径不可访问；环境中没有可调用的 dsh 命令。

## 证据与限制

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

## 三条候选接入路线

1. **外部 Agent 后端扩展**：若 DSH 官方允许插件接管完整回合，可由 Fish 拥有唯一 Agent loop，插件转换输入、输出流、取消及工具请求。最契合需求，但目前无证据证明接口存在。
2. **模型 Provider 代理**：若 DSH 支持插件注册自定义 Provider，可将 DSH 模型请求转到 Fish，不访问真实 DSH 模型端点。这通常有利于沿用 UI 流式显示，但必须规定 loop 所有权。Fish 若负责工具循环，DSH 不能再次执行相同工具；Provider 能否维持原生工具卡片仍待验证。不能把网络模型兼容性等同于完整外部 Agent 兼容性。
3. **请求前拦截 + 外部结果提交**：要求同时支持停止原回合、合法提交 assistant 输出、工具/流事件及结束状态。现有 inject/followup 不能代替这些接口。不能只靠 append 某条事件就宣称闭环成立。

DSH 插件主动连接 Fish 与上述宿主接入机制是不同层的问题。主连接可通过 HTTP 长轮询、SSE+POST 或 WebSocket 实现双向逻辑消息；具体方式未冻结。Fish 无需连接 DSH 入站端口。

## 当前结论

架构上存在可行路线；本地现有证据不足以确认“只开发插件即可完全替代 DSH 原生模型体验”。DSH 未核实能力是集成验证项，不阻止先定义 Fish 自身需求。

下一步需要可访问的 DSH 当前版插件/Provider/Agent 契约、源码或运行实例，核实上述三条路线。首个验收应包括：无 DSH 真实模型请求、Fish 返回合法文本、历史重开一致、一次工具往返、流式与取消、单次执行、trace 关联。当前均未执行。
