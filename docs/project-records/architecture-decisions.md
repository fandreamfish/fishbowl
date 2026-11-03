# Fishbowl 架构决策记录

## 当前生效的任务执行模型（覆盖早期 AD-013/AD-014）

QQ 对接能力和 DSH 操作能力独立接入 Fishbowl。QQ 是消息渠道，DSH 是可选执行能力；Fish 根据任务需要选择能力，不把 QQ 消息固定转发给 DSH。QQ 请求修改代码只是组合使用两项能力的示例，其他入口或 Fish 自身任务也可以调用 DSH。能力关系不等同于物理连接建立方向。

首期不实现“拦截 DSH 用户输入、阻止原模型请求、Fishbowl 生成 assistant 回复并回灌 DSH”的闭环。Fishbowl 从 QQ 等入口接收任务，负责理解任务并下发任务请求；DSH Control Plugin 主动连接 Fishbowl，DSH 使用自己的 Agent、模型和工具完成任务。

DSH 从接到命令到命令完成的全部过程由 DSH 自己掌控。Fishbowl 不接收中间思考、工具调用或进度事件；业务输出为最终结果或错误，另允许任务接收确认、心跳、查询和取消确认。连接建立方向是 DSH → Fishbowl，任务消息可以沿同一双向 WebSocket 连接由 Fishbowl → DSH 发送。

完整任务与验收规则见 [task-execution-rules.md](task-execution-rules.md)。

> 状态：需求澄清中
>
> 规则：只有用户明确确认或双方明确形成共识的内容才进入“已确认决策”；建议和待验证事项单独列出。

## 已确认决策

### AD-001：Fishbowl 必须可以脱离 DSH 独立运行

Fishbowl 的核心运行时不能以 DSH 为启动前提。DSH 未安装、未启动或连接失败时，fishbowl 仍应运行自身能力。

### AD-002：DSH 是可选外部能力提供方

DSH 不属于 fishbowl 核心运行时。fishbowl 可以在运行时连接或断开 DSH。

### AD-003：通过 DSH 插件进行交互

不让 fishbowl 直接操作 DSH 内部对象或 DSH 内部文件，而是在 DSH 内运行一个专门的 DSH Control Plugin，由插件调用 DSH 官方能力。

### AD-004：DSH 插件对外提供通用协议

DSH Control Plugin 类似一个 MCP Server/能力服务器，通过 HTTP 或兼容 MCP 风格的协议与 fishbowl 通信。

### AD-005：Fishbowl 不知道 DSH 专用信息

fishbowl 不依赖 DSH 的包名、`ctx`、内部 Agent/Session API、内部事件名、私有文件格式和具体版本差异。

DSH 专用知识封装在 DSH Control Plugin 中。

### AD-006：使用能力发现而不是硬编码 DSH 能力

fishbowl 连接后获取能力清单，根据实际能力启用功能。能力清单应包含能力类型、Schema、权限和不可用原因等信息。

### AD-007：协议不只支持 Tool

协议应覆盖：

- 操作能力（Tools/Commands）
- 读取能力（Resources/Queries）
- 实时事件（Events/Subscriptions）
- 能力发现
- 认证授权
- 错误与版本协商

### AD-008：用户选择 DSH 全能力范围

目标能力范围包含 Agent、Session、Tool、Plugin、Config、Runtime 和 Event 等控制域。

但具体能力是否存在、是否可通过正式 API 调用，需要后续 DSH 能力审计确认。

### AD-009：同时维护完整记录和结构化文档

所有后续讨论继续写入：

- `conversation-log.md`：完整讨论档案
- `requirements.md`：结构化需求
- `architecture-decisions.md`：架构决策
- `roadmap.md`：阶段路线和待办

## 已确认的协议路线

### AD-002：内部主协议采用 Fishbowl Control Protocol

已确认：Fishbowl 与 DSH Control Plugin 之间的内部主协议采用 Fishbowl Control Protocol，不直接把标准 MCP 作为完整控制协议。

协议应覆盖 Agent、Session、Tool、Plugin、Config、Runtime、Event、认证、授权、审计、幂等、取消、错误和版本协商等能力。

同时保留 MCP 兼容方向：后续可提供独立的 MCP Compatibility Gateway，将适合对外暴露的 Tools/Resources 映射为标准 MCP 能力。MCP 兼容层不是 Fishbowl 内部完整控制面的替代品。

这项决策的比较依据见本文“协议路线比较”章节。

### AD-010：DSH 插件主动连接 Fishbowl

已确认连接主模型为：DSH Control Plugin 主动连接 Fishbowl Runtime。Fishbowl 不主动依赖 DSH；连接成功后由插件报告能力并转发 DSH 事件。

本地和远程可以采用不同传输与认证方式，但不改变“DSH 插件主动建连”的主方向。

### AD-011：Fishbowl 是状态和账本唯一归属方

Fishbowl Runtime 拥有个体、记忆、账本、会话业务状态和相关运行状态。DSH 插件不得直接写 Fishbowl 内部状态，其他入口也应通过 Fishbowl Runtime 写入。

### AD-012：首期采用已确认能力的最小范围

当前不实现 DSH 全部控制能力。首期只实现已知并能通过 DSH 能力审计确认的功能，优先验证 DSH 插件主动连接、Fishbowl 任务下发、DSH 内部执行、最终结果回传、连接和能力发现。

### AD-013：DSH 对话由 Fishbowl 作为思考主体（已废弃）

历史方案：用户在 DSH 输入后由 Fishbowl 作为思考主体。该方案已被当前任务执行模型替代，不作为首期实现目标。
### AD-014：Fish 和 DSH 各自拥有 Agent 循环

Fish 拥有自己的模型、上下文、记忆、工具选择和编排循环；DSH 拥有受委托任务的执行循环。此前将 Fish Agent 整体后置的表述已修正。首期按实际能力范围实现 Fish Agent，不要求建设完整通用 Agent 平台。
### AD-015：审计是核心基础设施

已确认：所有重要操作必须可追溯。审计不是普通运行日志的附属功能，而是 Fishbowl Runtime 与 DSH Control Plugin 之间的基础设施。

Fish 记录自身模型和编排活动及委托任务边界，DSH 本地记录内部模型、工具和审批执行。两端按任务 ID 和 trace 关联，DSH 内部过程不传给 Fish。全链路审计不等于把所有记录集中到 Fish。

审计记录采用追加式、统一事件格式和关联 ID；敏感内容必须脱敏或按策略不落盘；审计应支持检索和从端到端 trace 还原操作路径。高风险操作可配置为审计失败即拒绝执行。

首期实现消息、模型、工具、连接、权限、状态写入和错误链路审计；复杂管理审计后置。

### AD-016：DSH 插件主动连接，Fishbowl 双向下发任务

DSH Control Plugin 主动向 Fishbowl Runtime 建立持久双向连接。首选传输为 WebSocket；本地部署可替换为等价 IPC，远程部署必须使用认证和加密传输。

Fishbowl 发送任务请求后，DSH 在本地完全掌控执行过程；Fishbowl 不接收中间思考、工具调用或进度。允许接收/拒绝、心跳、任务查询、取消确认和最终结果等协议消息。

### AD-017：异步委托任务和恢复

用户已确认采用 task-execution-rules.md：授权项目标识映射工作区，首期复用绑定执行会话；异步持久化任务，等待期间 Fish 可继续聊天；同任务 ID 去重，超时/断线不盲重跑，重连核对或补投结果；结果未知必须显式表达，取消需 DSH 确认。

### AD-018：分端授权、审计和来源记忆

按渠道身份、鱼、能力和项目授权；DSH 内部审批由 DSH 自己处理。两端各记自身审计，通过任务 ID 关联。Fish 记住委托和执行端报告的结果，标注 DSH 来源，不把结果记作自己亲自执行或独立验证。

### AD-019：补充信息作为本次任务的结束结果

DSH 返回 needs_input 和问题、已完成影响后结束本次任务。Fish 向原请求者询问，用户补充后创建关联的新任务 ID，携带上下文和剩余目标，不重新打开原任务或重复已完成操作。needs_input 不等于任务目标成功，也不用于绕过工具审批。
### AD-020：当前使用 TypeScript，为后续 Rust 迁移保留边界

用户已确认：Fish 主体当前使用 TypeScript，运行于 Node.js；新增核心代码统一使用 TypeScript，已有 JavaScript 按需迁移，不做全量重写。DSH 插件沿用其 JS/TS 环境。

通信协议不依赖 TypeScript 专属对象；记忆、事件账本和任务记录使用带版本号的通用数据格式，不直接序列化 JS 类实例。模型调用、存储、网络和时钟通过接口接入，核心业务逻辑与 Node.js 运行环境分离。保留输入、状态变化和输出的行为测试样例，供未来 Rust 实现验证兼容性。

未来可以逐模块迁移到 Rust，必要时允许 Rust 与 TypeScript 组件跨进程共存；迁移需要重写和验证，不承诺自动转换。当前不维护两套实现，也不因此立即引入跨进程服务。Rust 迁移没有确定时间表，不是首期验收前提；DSH 插件不要求随主体迁移。

### AD-021：Jev 作为可选快速决策模型

用户确认后续可能使用 Jev（TypeSafe System One）处理低延迟、固定答案空间的判断。Jev 作为 Fish 的可选 `DecisionProvider`，用于意图分类、DSH 调用路由、消息优先级、记忆分类、风险预筛选和结果完整性提示等；它不替代 Fish 主模型，不生成 QQ 回复、代码或开放式任务说明。

权限、幂等、任务状态、取消和安全边界仍由程序规则负责；Jev 的概率输出只能作为路由或升级人工/主模型的依据，不能单独授权高风险操作。DSH 内部模型与执行流程不因 Fish 使用 Jev 而改变。接入方式应封装在语言无关的决策接口后，未来 Rust 迁移时可重写 Provider。

当前仅确认保留该扩展方向，未接入 Jev API，也未确认其中文准确率、服务稳定性、隐私和成本；实际启用前须单独完成小规模评估和降级方案。

## 建议但尚未最终冻结


### AD-C-003：认证方式

候选：

- 本机 IPC 权限
- localhost + token
- mTLS
- 短期 token + 签名请求
- 组合方案


## 明确禁止的做法

- fishbowl 直接 import DSH 内部包
- fishbowl 读取或修改 DSH 私有文件来实现正式控制
- DSH 插件直接承担 fishbowl 情绪、记忆和个体业务
- 用版本号猜测 DSH API，而不进行能力协商
- 默认把高权限远程控制端口暴露到公网
## 协议路线比较

### 方案 A：直接采用标准 MCP

#### 优点

- 生态成熟，已有客户端、服务端、SDK、调试工具和文档可以复用。
- Fishbowl 与 DSH 插件之间的基础通信语义更容易被其他 MCP 客户端理解。
- Tool、Resource、Prompt 等概念已有通用约定，初始开发成本较低。
- 未来接入其他 MCP Server 或让其他客户端访问 DSH 能力更容易。
- 能力发现、工具 Schema 和基本调用流程不需要从零设计。

#### 缺点

- MCP 的核心定位更接近“模型上下文/工具能力协议”，不一定完整覆盖 DSH 的高权限控制面。
- Agent 生命周期、Session fork/flush、工具审批、插件启停、配置修改、运行时管理等能力可能需要扩展或使用非标准约定。
- 如果直接把 DSH 全部能力暴露成 MCP Tool，容易把高风险管理操作伪装成普通工具调用。
- 标准 MCP 的事件、长连接、取消、进度、幂等、审计和权限语义可能不足以满足本项目要求，仍需补充约定。
- 一旦依赖某个 MCP SDK 的具体实现，协议升级或 SDK 行为差异可能反过来影响 Fishbowl。
- “所有能力都能用 Tool 表达”会导致资源读取、事件订阅和管理操作的边界不清晰。

#### 适合的情况

- 目标主要是把 DSH 的少量工具和资源提供给模型或通用 MCP 客户端。
- 首要目标是快速接入生态，而不是完整控制 DSH 生命周期。
- 可以接受把部分高级能力定义为项目私有扩展。

### 方案 B：定义 Fishbowl Control Protocol，并兼容 MCP 风格

#### 优点

- 可以围绕本项目真实需求设计 Agent、Session、Tool、Plugin、Config、Runtime、Event 等完整控制域。
- 可以明确区分读取、操作、事件订阅和高风险管理命令，不把所有能力都压成普通 Tool。
- 可以原生设计权限、审计、幂等、取消、超时、重试、版本协商和能力降级。
- Fishbowl 只依赖稳定的通用控制语义，DSH 版本差异全部封装在 DSH 插件中。
- 未来可以定义多个 Provider，DSH 只是其中一个实现，不需要让 Fishbowl 认识 DSH。
- 可以提供 MCP 兼容层：把安全的 Tools/Resources 暴露给标准 MCP 客户端，同时保留完整控制协议给 Fishbowl。

#### 缺点

- 需要自行定义协议、Schema、错误码、事件格式、认证、授权、版本和兼容策略。
- 初期实现和测试成本更高，容易出现协议设计不足或语义不一致。
- 生态工具不能直接使用全部自有能力，需要额外编写适配器或 MCP Gateway。
- 需要长期维护协议规范、客户端、服务端和兼容矩阵。
- 如果没有严格的能力边界，容易设计成过度复杂的“远程 DSH 内核 API”。

#### 适合的情况

- 目标是 Fishbowl 独立运行，并对 DSH 进行完整、可审计、可授权的控制。
- 需要支持本地 IPC、同机跨用户和远程部署。
- 需要覆盖 DSH 的 Agent/Session/Tool/Plugin/Config/Runtime 全部控制域。
- 需要多个不同宿主或 Provider，而不希望 Fishbowl 绑定某个宿主。

### 方案结构（已确认）

基于本项目“Fishbowl 独立运行 + DSH 全能力控制 + 完全解耦”的目标，已确认采用方案 B 作为内部主协议，并保留方案 A 的兼容出口：

```text
Fishbowl Control Protocol（内部完整控制面）
                 │
                 ├── DSH Control Plugin Adapter
                 └── 可选 MCP Compatibility Gateway
```

后续工作不是重新选择协议路线，而是完成以下设计和验证：

1. DSH 官方能力审计
2. 标准 MCP 当前版本能力核对
3. 全部控制域的安全分级
4. 事件、取消、幂等、审计和版本协商需求确认
5. 评估 MCP 兼容层应暴露哪些安全的 Tools/Resources
