# Fishbowl 独立运行项目路线图

> 当前阶段：需求澄清与架构确认，暂不开发代码。
>
> 当前能力模型：Fish 独立拥有 QQ 消息对接能力和 DSH 操作能力，按任务需要组合调用。“QQ 请求修改代码 → Fish 选择 DSH → DSH 返回结果 → Fish 回复 QQ”是验收示例，不是固定管道。旧的“拦截 DSH 对话并替代模型请求”路线已废弃。
>
> 已确认的异步执行、结果、恢复和审计验收见 [task-execution-rules.md](task-execution-rules.md)。

## 阶段 0：需求和事实确认

2026-11-03 进展：CLI rc.2 真内核+脚本模型探针的代码工具往返、错误、取消、补充信息结果信封及排队关联五个场景通过；桌面 rc.5 完成静态核对。完整协议/桌面激活/真实模型/恢复仍未验收，详见 dsh-task-validation.md。

后续设计产物：[最小任务协议草案](task-protocol-design.md) 与 [插件状态机草案](dsh-control-state-machine.md)。已细化接收与结果双确认、结构化终态、needs_input 新任务、取消竞态和崩溃窗口；未进入生产实现。下一步评审草案，再制定分阶段实施计划，优先验证桌面会话排他、精确取消、结构化结果和恢复证据。协议核心测试与真实 DSH 接入分开验收。

需求与总体设计文档：[详细 SRS](srs-detailed.md)、[SRS 摘要版](srs.md)、[详细总体设计](overall-design-detailed.md) 与 [总体设计概览](overall-design.md) 已根据全部当前资料生成。详细版分别作为需求和架构评审基线；概览版便于快速阅读。文档仍为待评审草案，不能替代用户对协议参数和实现计划的确认。

实现级设计：[详细设计说明书](detailed-design.md) 已补充模块接口、领域模型、调度算法、协议处理、事务/持久化、错误映射和测试断言。以上设计文件均需先评审，且 DSH 桌面集成门槛未验证前不得宣称闭环生产可用。

本阶段的硬门槛是验证 DSH 任务执行闭环，而不是验证 DSH 对话替代闭环：DSH 插件主动连接 Fishbowl，Fishbowl 下发任务，DSH 内部执行并只返回最终结果或错误。

目标：在写代码前确定边界，避免围绕错误假设重构。

产物：

- 完整讨论记录
- 结构化需求
- 架构决策记录
- DSH 能力矩阵
- DSH 官方 API 证据和版本范围
- 协议候选方案对比
- 部署拓扑和安全要求

重点问题：

- DSH 当前公开/可用的 Agent、Session、Tool、Plugin、Config、Runtime API
- 哪些能力能由插件安全暴露
- 哪些能力需要 DSH 新增官方接口
- 哪些能力不能稳定实现
- DSH 插件能否主动建立到 Fishbowl Runtime 的连接
- DSH 任务能否进入指定 Agent/Session 并由 DSH 内部完成
- DSH 能否只回传最终结果或错误，不暴露中间执行过程

阶段 0 的硬门槛：

只有当“Fishbowl 任务请求 → DSH 内部执行 → 最终结果回传”的最小任务闭环被 DSH 实际 API 或可验证的插件机制证实后，才进入实现阶段。DSH 接到任务后的中间过程不属于 Fishbowl 协议首期范围。

## 阶段 1：独立领域能力整理

目标：让核心能力不依赖 DSH。

已确认技术路线（AD-020）：当前以 TypeScript / Node.js 实现，复用现有模块，JavaScript 按需迁移；通过通用协议、版本化数据、运行环境接口及行为测试保留后续 Rust 迁移空间。首期不维护 Rust 双实现，不为未来迁移预先拆成多进程服务，迁移时间另行决定。

扩展方向（AD-021）：预留可选 Jev DecisionProvider，先用于意图、路由、优先级和风险等快速判断。它不进入首期必需闭环；接入前单独评估 API、中文效果、降级、隐私与成本。

范围：

- affect
- being
- memory
- schedule
- voice
- journal
- app
- 可拆分的 bilibili 能力

验收方向：

- 无 DSH 环境可加载
- 独立测试
- 明确存储边界
- 明确 LLM、Clock、Store 等端口
- 业务层不出现 DSH import

## 阶段 2：独立 Runtime 设计

目标：定义 fishbowl 自己的启动、会话、事件和服务边界。

需要确定：

- 进程入口
- 配置目录
- 状态目录
- 会话模型
- Agent/模型端口
- 工具运行时
- 事件总线
- HTTP/CLI/其他入口
- 健康检查和诊断
- 关闭、恢复和迁移语义

## 阶段 3：控制协议设计

目标：定义 fishbowl 与外部能力提供方之间的稳定边界。

协议需要覆盖：

- hello/handshake
- capability discovery
- resources
- commands/tools
- event subscription
- authentication
- authorization
- timeout/retry
- idempotency
- error model
- version negotiation

## 阶段 4：DSH Control Plugin 设计

目标：把 DSH 专用知识封装在插件内。

插件负责：

- DSH 官方 API 适配
- 能力暴露
- DSH 事件转换
- 权限与审计
- 版本兼容
- 连接管理
- 能力不可用时的明确错误

## 阶段 5：独立 Runtime 与 DSH 联调

目标：fishbowl 不依赖 DSH 启动，但可以接收 QQ 任务并通过已连接的 DSH 完成最小执行闭环。

优先闭环：

1. 分别验证 QQ 消息收发与 DSH 能力发现、认证
2. 验证授权项目和绑定会话的任务提交、接收确认
3. DSH 内部自主执行，Fish 等待期间继续处理消息
4. 最终结果进入 Fish 队列，回复原请求者并记录带来源的记忆
5. 重复提交/结果、超时、断线重连、重启与取消验证
6. 两端分开审计，按任务 ID 关联，Fish 不接收 DSH 中间执行过程

## 阶段 6：扩展到完整 DSH 控制

按风险逐步实现：

1. Agent 管理
2. Session 管理
3. Tool 查询和调用控制
4. Plugin 管理
5. Config 管理
6. Runtime 管理和诊断

高风险能力必须具备独立权限、审计和确认策略。

## 阶段 7：生产化

目标：支持真实部署和升级。

范围：

- 本地 IPC/localhost
- 同机不同用户权限
- 远程 TLS/mTLS 或等价方案
- Token/密钥轮换
- 进程守护
- 日志和审计归档
- 备份与恢复
- 版本兼容
- 能力降级
- 断线重连
- 数据迁移
- 回滚

## 当前不执行

在需求和架构尚未确认前，不执行：

- 新增 Runtime 代码
- 新增 DSH Control Plugin 代码
- 重构现有 package
- 迁移数据格式
- 对外发布 package
## 首期开发前必须补充确认的风险项

### 1. DSH 任务执行闭环可行性

- DSH 插件能否主动建立到 Fishbowl 的持久双向连接
- Fishbowl 任务能否进入指定 DSH Agent/Session
- DSH 能否在内部完成模型和工具调用并返回最终结果
- Fishbowl 是否可以完全不接收中间执行事件
- 任务 ID、幂等、超时、取消、断线和重连如何保持一致

### 2. Fishbowl 任务编排

- 入口消息到任务请求的模型、上下文和权限
- DSH 能力发现与任务 Schema
- 最终结果如何进入记忆、QQ 回复和审计
- Fishbowl 自身超时、取消和重试边界

### 3. 协议可靠性

- 握手、能力发现和版本协商
- 请求 ID、trace ID、parent ID 和幂等键
- 事件顺序、重复、丢失和断线恢复
- 异步长任务、最终结果补投、取消和背压；不要求 DSH 过程流式回传
- 统一错误码和降级策略

### 4. 审计与数据安全

- 消息、模型、工具、权限、状态和 DSH 回传全链路审计
- 敏感信息脱敏策略
- 追加写入、查询、归档和审计失败策略
- 权限、Token、TLS/IPC 和高风险操作保护

### 5. 数据一致性

- Fishbowl Runtime 作为唯一业务状态写入者
- 状态、账本、审计和消息的关联关系
- 重复消息和重试不产生重复业务事件
- 崩溃恢复、未完成工具调用和半完成回合处理

### 6. 运行和部署

- DSH 插件主动连接、心跳和重连
- Fishbowl 启停和优雅关闭
- 多 DSH 实例隔离
- 配置、密钥、日志和状态目录权限
- 备份、恢复、升级和协议回滚

## 首期建议只实现

一个 Fishbowl Agent、一个 Model Provider、QQ 消息适配器、DSH 操作能力适配器、授权项目与绑定会话、异步任务和最终结果回传、基础能力发现与认证、分端审计和恢复机制。QQ 组合用例不是唯一任务路径。

## 可以后置

- 全部 DSH 管理能力
- 多 Agent/多模型路由
- 并行工具调用和复杂规划
- 插件启停与 DSH 配置管理
- MCP Compatibility Gateway
- 高级审计分析、远程归档和多节点部署

## 首期不应绕过的工程门槛

在 DSH 任务提交、DSH 自主执行、最终结果回传和审计关联未验证前，不应大规模重构现有业务包。具体首期验收以 task-execution-rules.md 为准，独立 Fish 的需求与设计可以继续推进。
