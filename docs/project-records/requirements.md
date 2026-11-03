# Fishbowl 独立运行与 DSH 控制需求基线

> 状态：需求澄清中
>
> 本文只记录已经提出或确认的需求，不代表所有协议字段和实现方案已经冻结。

## 1. 项目目标

将当前以 DSH 插件为主要入口的 fishbowl，演进为一个可以独立运行的程序，同时通过一个独立的 DSH 插件访问和操作 DSH。

目标结构：

```text
Fishbowl Standalone Runtime
        │ 通用 HTTP / MCP 风格控制协议
        ▼
DSH Control Plugin
        │ DSH 官方 API
        ▼
DSH Runtime
```

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

### R-001A Fishbowl 独立 Agent Runtime

由于 Fishbowl 是独立思考主体，Fishbowl Runtime 必须拥有自己的 Agent 执行能力，不能把核心思考流程依赖于 DSH Agent loop。

首期至少需要：

- Model Provider 抽象和至少一个模型实现
- 消息/上下文组装
- ReAct 或等价的“模型请求 → 判断工具调用 → 执行工具 → 回传结果 → 继续思考”的循环
- Fishbowl 自有工具注册、Schema、调用和结果处理
- 记忆、账本和状态摘要注入
- 最大循环次数、超时、取消和错误处理
- 中间步骤和最终结果的事件记录
- 统一的 Agent 会话状态

DSH Control Plugin 只负责 DSH 宿主接入、消息转发和可选的 DSH 能力调用，不负责 Fishbowl 的核心思考循环。

首期不要求实现完整通用 Agent 平台，不要求立即支持多模型路由、复杂规划、并行工具调用、长期任务恢复或全部 DSH 工具；这些能力后续按需求增加。

### R-002 DSH 主动连接与可选接入

DSH 不是 fishbowl 的启动前提，而是可选的外部能力提供方。连接方向首选由 DSH Control Plugin 主动连接 Fishbowl Runtime；连接成功后，插件通过 Fishbowl Control Protocol 暴露当前可用能力。

fishbowl 应能：

- 接受 DSH Control Plugin 的连接
- 获取插件提供的能力清单
- 根据能力清单决定可用功能
- 调用或请求 DSH 能力
- 接收 DSH 事件
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

- DSH 对话消息接收
- DSH 对话内容转发到 Fishbowl
- Fishbowl 生成回复并回传 DSH
- 已确认的上下文注入或消息发送
- 已确认的 Agent/Session 事件接收
- 已确认的工具调用或工具结果转发
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
- 需要支持从 DSH 输入追踪到 Fishbowl 思考、工具调用、状态变化和 DSH 回复
- 审计写入失败必须产生明确告警；高风险操作可配置为“审计失败即拒绝执行”
- 多进程或多入口的审计事件必须使用统一格式和关联 ID

首期至少实现消息链路、模型调用、工具调用、DSH 连接、权限判断、状态写入和错误处理的审计；更复杂的管理审计可后续扩展。
### R-009 Fishbowl 状态和账本归属

fishbowl 的个体、记忆、账本、会话业务状态和相关运行状态全部归属 Fishbowl Runtime，由 Fishbowl 负责持久化、恢复、迁移和备份。

DSH Control Plugin 不直接写 Fishbowl 内部状态；DSH 只提供宿主事件和控制能力。Fishbowl 也不依赖 DSH 内部文件实现控制。

DSH 插件、QQ、HTTP、CLI 等入口不得绕过 Fishbowl Runtime 直接并发写同一本账。

### R-010 资料持续记录

后续所有需求澄清、架构决策、协议讨论和重要结论都要记录为项目资料。

资料分为：

- 完整对话档案：`conversation-log.md`
- 结构化需求：本文件
- 架构决策：`architecture-decisions.md`
- 规划和阶段：`roadmap.md`
- 后续可增加 DSH 能力矩阵和协议规范

### R-011 DSH 对话代理链路

首期目标链路：

```text
用户在 DSH 输入消息
        ↓
DSH Control Plugin 拦截/接收消息
        ↓ HTTP/Control Protocol
Fishbowl Runtime 接收消息并进行思考
        ↓
Fishbowl 按需调用自己的模型、记忆和工具
        ↓
Fishbowl 将最终回复或中间控制结果返回给 DSH Plugin
        ↓
DSH Plugin 将回复交给 DSH 会话展示
```

在该模式下，DSH 本轮不应重复调用自己的大模型；Fishbowl 是本轮回复的思考主体。

首期必须验证：

- DSH 插件能否在 DSH 大模型请求前拦截用户消息
- 拦截后能否阻止或替代原本的 DSH 模型请求
- Fishbowl 回复能否作为合法的 assistant 输出回到 DSH 会话
- DSH UI 是否能正常展示 Fishbowl 返回的回复
- Fishbowl 思考期间的工具调用如何执行、审批、回传和记录
- 超时、断线、取消和重复请求如何处理

如果 DSH 当前 API 不能完成“拦截并替代模型请求”或“回灌合法回复”，则需要调整为 DSH 插件与 Fishbowl 的事件/消息桥接模式，不能直接宣称等同于 DSH 原生模型调用。

## 3. 角色与边界


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
