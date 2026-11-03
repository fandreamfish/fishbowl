# Fishbowl 独立运行项目路线图

> 当前阶段：需求澄清与架构确认，暂不开发代码。

## 阶段 0：需求和事实确认

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
- DSH 能否在模型请求前拦截并阻止原始模型调用
- Fishbowl 回复能否作为合法 assistant 输出回灌 DSH 会话
- Fishbowl 思考期间的工具调用能否由插件转发、执行和返回结果
- DSH UI 能否正常展示 Fishbowl 返回内容

阶段 0 的硬门槛：

只有当“消息拦截/替代模型请求/回复回灌”的最小闭环被 DSH 实际 API 或可验证的插件机制证实后，才进入实现阶段；否则需要调整为事件桥接或独立消息展示模式。

## 阶段 1：独立领域能力整理

目标：让核心能力不依赖 DSH。

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

目标：fishbowl 不依赖 DSH 启动，但可以连接 DSH 并完成最小闭环。

优先闭环：

1. 连接和能力发现
2. 读取 Agent/Session 状态
3. 接收事件
4. 发送消息
5. 注入上下文
6. 唤醒/取消

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

### 1. DSH 最小闭环可行性

- 用户消息是否能在 DSH 模型请求前被插件捕获
- 是否能阻止原 DSH 模型请求
- Fishbowl 回复是否能作为合法 assistant 消息写回当前会话
- DSH UI 是否能展示回灌结果
- 工具调用期间是否能保持同一 trace 和会话状态

### 2. Fishbowl Agent Runtime

- Model Provider 端口和超时/取消
- ReAct 或等价工具循环
- 工具 Schema、权限和结果规范
- 上下文、记忆、情绪和状态注入
- Agent 状态机和循环上限

### 3. 协议可靠性

- 握手、能力发现和版本协商
- 请求 ID、trace ID、parent ID 和幂等键
- 事件顺序、重复、丢失和断线恢复
- 长任务、流式结果、取消和背压
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

一个 Fishbowl Agent、一个 Model Provider、少量 Fishbowl 自有工具、一个 DSH 对话入口、一个最终回复出口、基础能力发现、基础认证、全链路审计和最小恢复机制。

## 可以后置

- 全部 DSH 管理能力
- 多 Agent/多模型路由
- 并行工具调用和复杂规划
- 插件启停与 DSH 配置管理
- MCP Compatibility Gateway
- 高级审计分析、远程归档和多节点部署

## 首期不应绕过的工程门槛

在 DSH 最小对话闭环和审计链路未验证前，不应大规模重构现有业务包或实现完整 Runtime。
