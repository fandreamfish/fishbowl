# Fishbowl 独立运行与 DSH 控制需求基线

> 状态：需求澄清中
>
> 本文只记录已经提出或确认的需求，不代表所有协议字段和实现方案已经冻结。
>
> 2026-11-03 已确认任务规则见 [task-execution-rules.md](task-execution-rules.md)：独立 Agent、授权项目、异步任务、最终结果、恢复、审批、分端审计和来源记忆。
>
> 接口细化草案见 [task-protocol-design.md](task-protocol-design.md) 与 [dsh-control-state-machine.md](dsh-control-state-machine.md)。其中 Schema、认证方式、默认上限和插件状态转换尚待评审，不代表已有实现。

## 1. 项目目标

将当前以 DSH 插件为主要入口的 fishbowl，演进为一个可以独立运行的程序，同时通过一个独立的 DSH 插件访问和操作 DSH。

能力关系（不表示物理连接建立方向）：

```text
Fishbowl Standalone Runtime
  ├── QQ 适配器：接收消息、发送回复
  ├── DSH 操作能力 → DSH Control Plugin → DSH Runtime
  └── 其他入口和能力
```

QQ 对接与 DSH 操作是 Fish 拥有的两项独立能力，不构成固定转发管道。用户可以通过 QQ 请 Fish 完成任务；Fish 根据任务需要选择调用 DSH，也可以直接回复或使用其他能力。DSH 调用不限定由 QQ 消息触发。

### 已确认的实现语言与迁移约束

当前 Fish 主体使用 TypeScript 与 Node.js，新增核心代码统一 TypeScript，现有 JavaScript 按需迁移。通信协议及持久数据格式保持语言无关并带版本管理，核心逻辑通过接口隔离模型、存储、网络和时钟；保留可用于未来 Rust 实现的行为测试样例。

后续允许逐步迁移到 Rust，但当前不维护双实现，不要求全量重写，不提前增加跨进程服务。DSH 插件可继续使用 JS/TS。此决定仅确认技术路线，不代表任务协议草案已获批准或开始编写代码。详见 architecture-decisions.md 的 AD-020。

Fish 后续可增加 Jev `DecisionProvider` 作为快速决策模型，用于固定选项分类、路由、优先级和风险预筛选。Jev 不承担主模型对话、文本生成、代码生成或程序权限判定；启用前须验证中文效果、成本、隐私、稳定性和失败降级。详见 architecture-decisions.md 的 AD-021。

## 2. 核心需求

### R-001 独立运行

fishbowl 在 DSH 未安装、未启动或不可连接时，仍可作为独立程序启动并运行其自身能力。

独立运行至少应支持：

- 独立进程启动和关闭
- 自己的配置管理
- 自己的个体与账本状态
- 自己的记忆处理
- 自己的模型调用或模型端口
- 自己的事件流
- 自己的会话/消息入口
- 自己的日志、诊断和健康检查

### R-001A Fishbowl 任务编排与 DSH 执行

Fish 保留自己的模型、上下文、记忆、工具选择和 Agent 编排循环，DSH 的独立执行循环负责受委托任务。Fish 的 Agent 能力不因 DSH 自主执行而取消或整体后置。

Fishbowl Runtime 负责接收消息、理解用户意图并选择所需能力。需要 DSH 执行的任务才通过 DSH 操作能力下发；QQ 消息不自动转发给 DSH。首期不要求 Fishbowl 替代 DSH 的模型请求，也不要求 Fishbowl 参与 DSH 接到命令后的内部思考、工具调用或执行循环。

DSH 收到任务后，由 DSH 自己的 Agent、模型和工具完成从命令接收至命令完成的全过程。该过程由 DSH 独立掌控，Fishbowl 不感知中间步骤，不接收中间工具调用、思考过程或进度事件；业务输出只包含最终结果或错误，协议允许接收确认、拒绝、心跳、任务查询和取消确认。

首期至少需要：

- Fishbowl 到 DSH 的任务请求和最终结果回传
- DSH Control Plugin 对 DSH Agent/Session/Tool 的适配
- 任务 ID、幂等、超时、取消和断线语义
- Fishbowl 侧对最终结果的记忆和审计记录
- DSH 侧对内部执行过程的本地记录和审计

Fishbowl 不负责执行 DSH 的工具，也不依赖 DSH 内部 Agent loop 的具体实现。

### R-002 DSH 主动连接与可选接入

DSH 不是 fishbowl 的启动前提，而是可选的外部能力提供方。连接方向首选由 DSH Control Plugin 主动连接 Fishbowl Runtime；连接成功后，插件通过 Fishbowl Control Protocol 暴露当前可用能力。

fishbowl 应能：

- 接受 DSH Control Plugin 的连接
- 获取插件提供的能力清单
- 根据能力清单决定可用功能
- 调用或请求 DSH 能力
- 接收连接状态、任务完成和错误等协议事件；首期不接收 DSH 内部思考、工具调用或进度事件
- 处理连接中断、恢复和能力变化

本地和远程可以采用不同的传输与认证方式，但连接方向的主模型是“DSH 插件主动连接 Fishbowl”。

### R-003 完全解耦 DSH 知识

fishbowl 核心和业务层不得直接依赖：

- DSH 专用包名
- DSH `ctx` 对象
- DSH Agent/Session 内部对象
- DSH 内部文件格式
- DSH 内部事件名称
- DSH 版本差异
- DSH 插件生命周期实现

这些信息只能存在于 DSH Control Plugin 和协议适配层。

### R-004 首期 DSH 能力范围

长期目标是通过 DSH Control Plugin 操作 DSH 的相关能力，包括 Agent、Session、Tool、Plugin、Config、Runtime 和 Event 等控制域。

当前首期不实现全部功能，只实现已经确认、能够通过 DSH 现有能力验证的最小集合。首期候选范围包括：

- DSH Control Plugin 主动连接 Fishbowl
- Fishbowl 向 DSH 下发任务/命令
- DSH 使用自身 Agent 和工具完成任务
- DSH 返回最终结果或错误
- 连接、能力发现、认证和审计基础能力

其他 DSH 管理能力进入后续阶段，不作为首期上线前提。所有能力仍需通过 DSH 能力审计逐项确认，不得假设所有能力已经有公开稳定 API。

### R-005 动态能力发现

DSH Control Plugin 连接后必须能报告：

- 协议版本
- 插件自身版本
- 后端提供方标识
- 当前可用能力
- 能力类型
- 能力是否启用
- 所需权限
- 能力的输入/输出 Schema
- 能力限制或不可用原因

fishbowl 不应硬编码“DSH 必然拥有某能力”，而应依赖能力发现结果。

### R-006 通用协议交互

fishbowl 与 DSH 插件通过通用协议通信，协议至少覆盖：

1. 操作能力（Tools/Commands）
2. 读取能力（Resources/Queries）
3. 实时事件（Events/Subscriptions）
4. 能力发现（Capabilities）
5. 认证和授权
6. 错误、超时、重试和版本协商

内部主协议采用 Fishbowl Control Protocol；后续可提供独立 MCP Compatibility Gateway，将适合公开的 Tools/Resources 映射为标准 MCP。标准 MCP 不作为 Fishbowl 内部完整 DSH 控制面的替代协议。

### R-007 多部署形态

至少纳入以下部署形态：

1. 同机、同用户
2. 同机、不同用户
3. 不同服务器

本机优先考虑 IPC 或仅监听 localhost；远程部署必须使用安全传输和认证，且默认不应无意暴露高权限控制面。

### R-008 权限与审计

DSH Control Plugin 必须支持：

- 身份认证
- 权限校验
- 能力白名单
- 参数校验
- 高风险操作保护
- 请求 ID/幂等性
- 操作审计
- 错误审计
- 连接和授权状态审计

即使用户选择全部能力，也必须保留可配置权限模型。

### R-008A 全链路可追溯审计

Fishbowl 必须具备独立、持续和可查询的审计能力。所有重要操作都必须能够沿着同一个关联链追溯到：发起者、入口、目标、请求、决策、执行、结果和错误。

审计范围至少包括：

- Fishbowl Runtime 启动、停止、重启和配置变化
- DSH Plugin 建连、断连、重连、能力变化和认证授权
- 用户消息接收、转发、去重、取消和最终回复
- Model Provider 请求、响应、超时、重试和失败
- Agent 每个思考步骤、循环终止原因和最终状态
- 工具发现、权限判断、批准/拒绝、执行、结果和异常
- DSH 能力调用、参数校验、返回结果和错误
- 个体、记忆、账本、配置和其他状态变更
- 定时任务、外部通道和后台任务
- 安全相关事件和审计自身的异常

每条审计记录至少应具备：

- `eventId`：审计事件唯一 ID
- `traceId`：一次端到端操作链 ID
- `parentId`：父操作或调用关系
- 时间戳和时区
- 组件、实例、版本和环境
- 操作者/来源/身份
- 操作名称和目标资源
- 输入摘要和参数摘要
- 结果状态、错误码和错误摘要
- 耗时、重试次数和取消原因
- 关联的 Agent、Session、Creature、Tool 和 DSH 连接标识（适用时）

审计要求：

- 审计记录不能只存在普通运行日志中
- 敏感信息、密钥、Cookie、完整私密对话和模型凭据必须按策略脱敏或不落盘
- 审计记录应追加写入，并具备防意外覆盖能力
- 需要支持按时间、trace、对象、操作、结果和错误检索
- 需要支持从用户入口追踪 Fish 自身编排、DSH 任务请求、最终结果和回复；DSH 内部执行由 DSH 本地审计，按任务 ID 关联，不回传给 Fish
- 审计写入失败必须产生明确告警；高风险操作可配置为“审计失败即拒绝执行”
- 多进程或多入口的审计事件必须使用统一格式和关联 ID

首期至少实现 Fish 自身消息、模型、工具编排、DSH 连接、任务边界、权限、状态写入和错误审计；DSH 内部模型和工具执行记录由 DSH 持有。详见 task-execution-rules.md。
### R-009 Fishbowl 状态和账本归属

fishbowl 的个体、记忆、账本、会话业务状态和相关运行状态全部归属 Fishbowl Runtime，由 Fishbowl 负责持久化、恢复、迁移和备份。

DSH Control Plugin 不直接写 Fishbowl 内部状态；DSH 只提供宿主事件和控制能力。Fishbowl 也不依赖 DSH 内部文件实现控制。

DSH 插件、QQ、HTTP、CLI 等入口不得绕过 Fishbowl Runtime 直接并发写同一本账。

DSH 拥有自己的执行会话、代码工作区、任务去重与恢复记录；这些不属于 Fish 的人格账本。Fish 持有委托任务和回复状态，两端用任务 ID 关联。

### R-010 资料持续记录

后续所有需求澄清、架构决策、协议讨论和重要结论都要记录为项目资料。

资料分为：

- 完整对话档案：`conversation-log.md`
- 结构化需求：本文件
- 架构决策：`architecture-decisions.md`
- 规划和阶段：`roadmap.md`
- 后续可增加 DSH 能力矩阵和协议规范

### R-011 独立的 QQ 对接能力与 DSH 操作能力

示例用例：用户通过 QQ 请 Fish 修改代码，Fish 选择调用 DSH。以下是该用例的逻辑流程，不是所有消息的必经路径，也不规定部署拓扑：

```text
用户在 QQ 等入口输入任务
        ↓
Fishbowl Runtime 理解任务并按需选择 DSH 操作能力
        ↓ Fishbowl Control Protocol
DSH Control Plugin（主动建立的连接）接收任务
        ↓
DSH 使用自身 Agent、模型和工具执行任务
        ↓
DSH 仅回传最终结果或错误
        ↓
Fishbowl Runtime 将结果返回入口并写入审计/记忆
```

DSH 接到任务后是否调用自己的模型、如何规划、如何调用工具以及何时结束，完全属于 DSH 内部行为。Fishbowl 不要求拦截 DSH 用户输入、不阻止 DSH 原模型请求，也不要求向 DSH 会话回灌 Fishbowl 生成的 assistant 消息。

首期必须验证：

- DSH 插件能否主动建立并保持到 Fishbowl 的双向连接
- Fishbowl 能否发送任务请求并获得最终结果
- DSH 能否在内部选择 Agent/Session/Tool 完成任务
- 任务 ID、幂等、超时、取消、断线和重连如何处理
- 最终结果能否回到 QQ 等入口并关联同一审计链

DSH 需要补充信息时以 needs_input 结束本次任务，返回问题与已完成影响；Fish 向原请求者询问，得到答复后使用新任务 ID 创建关联后续任务。原任务不无限等待或自动续跑。详见 task-execution-rules.md。

## 3. 角色与边界

### 已确认的任务交互约束

- 使用已授权项目标识，由插件映射本地工作区；首期复用该鱼绑定的 DSH 执行会话。
- DSH 任务异步持久化；Fish 等待期间可继续处理消息，最终结果串行进入同鱼事件队列。
- DSH 返回成功、失败或取消等终态；无法核实时明确结果未知。代码任务结果包含修改文件、测试情况及必要产物。
- 同任务 ID 去重，断线/超时不自动重跑，重连查询或补投最终结果，取消须由 DSH 确认。
- 授权基于真实渠道身份、鱼、能力和项目；DSH 内部审批由 DSH 负责，无法审批时返回明确错误。
- Fish 保存任务边界审计和带 DSH 来源的结果记忆，DSH 保存内部执行审计。

完整规则与首期验收见 [task-execution-rules.md](task-execution-rules.md)。


### 3.1 Fishbowl Standalone Runtime

负责：

- fishbowl 领域模型
- 个体、情绪、记忆、账本
- 调度、B 站、QQ 等业务能力
- 自己的会话和模型编排
- 独立入口、日志、配置、健康检查
- 通用 Provider/Control Client
- 根据能力发现结果编排 DSH 调用

不负责：

- DSH 内部 API 适配
- 解释 DSH 版本差异
- 读取/修改 DSH 私有文件
- 依赖 DSH 生命周期

### 3.2 DSH Control Plugin

负责：

- 运行于 DSH 内部
- 调用 DSH 官方能力
- 把 DSH 能力转换成通用协议
- 能力发现
- 事件转发
- 请求认证和授权
- 参数校验
- 审计
- DSH 版本差异兼容
- 连接管理

不负责：

- fishbowl 情绪和记忆逻辑
- fishbowl 个体业务
- fishbowl B 站/QQ 业务
- fishbowl 领域状态持久化

## 4. 能力域

### Agent

- list
- get
- create
- resume
- dispose
- send/followup
- inject
- steer
- cancel
- whenIdle
- event subscription

### Session

- list
- get
- create
- fork
- flush
- events
- derived messages

### Tool

- list
- schema
- register
- restrict
- guard
- approve
- deny
- result
- execute

### Plugin

- list
- status
- enable
- disable
- reload

### Config

- read
- schema
- patch
- validation

### Runtime

- status
- health
- diagnostics
- logs/events
- version/capability negotiation

## 5. 非目标

当前阶段不做：

- 立即修改业务代码
- 立即实现独立 Runtime
- 立即实现 DSH Control Plugin
- 立即确定全部协议字段
- 通过修改 DSH 私有文件实现控制
- 把 DSH 内部对象直接暴露给 fishbowl
- 默认开放远程无限制管理能力

## 6. 当前验收方向

需求澄清完成时，应至少形成：

- 明确的独立运行边界
- 明确的 DSH 插件边界
- DSH 能力矩阵
- 协议选择结论
- 连接拓扑和认证方案
- 权限模型
- 数据写入和所有权模型
- 分阶段迁移路线
- 可被拆分实施的工程计划
