# Fishbowl 独立运行与 DSH 控制项目讨论记录

> 本文件是项目讨论档案，尽量保留每轮对话的原始意图与结论。结构化需求请看同目录下的 `requirements.md`、`architecture-decisions.md` 和 `roadmap.md`。
>
> 记录起点：本轮需求澄清

## 1. 用户：检查插件能否抽取并单独部署

用户希望检查当前插件：如果抽取出来单独部署，哪些部分可以抽取，哪些部分不能抽取。

### 分析结论

当前仓库不是一个单体插件，而是以下组合：

- DSH 插件：`packages/plugin`
- 核心/能力包：`affect`、`being`、`memory`、`schedule`、`voice`、`journal`、`bilibili`、`app`
- DSH 适配层：`adapter-dsh`
- QQ 独立进程：`bridge-qq`

可独立抽取的主要是：

- `affect`：纯函数、零 IO
- `schedule`：时间和配额计算
- `voice`：语气规则
- `journal`：文本能力
- `memory`：独立存储能力，但需要处理锁和并发
- `being`：领域实体库
- `app`：应用层库，但不是独立服务
- 部分 `bilibili`：需要去掉宿主胶水
- `bridge-qq`：已有独立进程入口

不能直接脱离 DSH 运行的主要是：

- `packages/plugin`：依赖 DSH 的 `apply(ctx)`、Agent、Session、工具和生命周期
- `packages/adapter-dsh`：直接接触 DSH API，只能作为适配层运行

当前代码具备分层基础，但多数 package 仍是私有包，且很多模块通过仓库相对路径引用，尚未完成真正的独立发布工程化。

## 2. 用户：希望完全独立运行，同时允许程序操作 DSH

用户明确希望独立抽取出来，不依赖 DSH 自己运行；同时允许该程序操作 DSH。

### 分析结论

这不是简单搬迁，而是“独立运行时 + DSH 控制适配器”的架构改造。

建议目标形态：

```text
fishbowl 独立主程序
├── affect / being / memory / schedule
├── app / Bilibili / QQ / 自己的模型与会话逻辑
├── 自己的运行时
└── DSH Connector

DSH Control Plugin
└── 通过 DSH 官方 API 控制 DSH Runtime
```

独立程序不应直接 import DSH 内部对象、读取 DSH 内部文件或依赖 DSH 生命周期。

## 3. 用户：希望拥有 DSH 全部能力

用户选择全部能力，包括聊天、Agent、工具和管理能力。

### 分析结论

这意味着 fishbowl 将成为 DSH 的高权限控制面，可能包括：

- Agent 查询、创建、恢复、销毁
- Session 创建、读取、fork、flush
- 消息发送、上下文注入、steer、cancel、等待空闲
- 工具查询、注册、限制、guard、批准、拒绝、结果读取
- 插件查询、启停、重载
- 配置读取和修改
- 运行状态、事件和诊断日志

建议不让 fishbowl 直接操作 DSH 内部，而是在 DSH 内开发一个专门的 Control Plugin，由它调用 DSH 官方 API并提供受控接口。

部署形态需要支持：

1. 同机同用户
2. 同机不同用户
3. 不同服务器

建议本机使用 IPC 或 localhost，远程使用 TLS 和认证；远程控制默认关闭或显式开启。

## 4. 用户：开发 DSH 插件与程序交互是否更好

用户提出：如果开发一个 DSH 插件和独立程序交互，是否比独立程序直接操作 DSH 更好。

### 分析结论

确认这是更好的方向：

```text
fishbowl 独立程序
        │ HTTP / MCP 风格协议
        ▼
DSH Control Plugin
        │ DSH 官方 API
        ▼
DSH Runtime
```

DSH 插件负责：

- DSH API 适配
- 事件转发
- 权限校验
- 审计
- 版本差异处理
- 连接生命周期

独立程序负责领域能力和业务逻辑，不负责 DSH 内部 API 细节。

建议将当前 `packages/plugin` 逐步缩减为薄适配层，业务逻辑迁移到独立 Runtime。

## 5. 用户：当前代码是不是原型，工程上下一步做什么

### 分析结论

当前代码属于“高级工程原型”：

- 领域能力已经比较完整
- DSH 集成已经验证
- QQ 已有独立桥接进程
- 事件账本、记忆和迁移设计较完整
- 但还没有独立 Runtime
- 还没有控制协议
- 还没有生产级安全和部署体系
- 包发布工程尚未完成

工程上下一步不是马上拆目录，而是先做：

1. DSH 能力清单审计
2. 独立 Runtime 边界定义
3. DSH Control Protocol 草案
4. 再开始代码迁移

## 6. 用户：所有交谈都要作为后期开发资料

用户要求：上面和后面所有交谈都需要记录下来，作为后期开发资料；目前不开发代码，先把需求搞清楚。

### 当前记录方式

决定维护两类资料：

1. 完整原始讨论记录：保留每轮用户意图、分析和结论
2. 结构化项目资料：提炼需求、架构决策、协议方向和路线图

本文件用于第 1 类资料。

## 7. 用户：Fishbowl 不需要知道 DSH 信息，DSH 插件像 MCP Server

用户提出的核心架构设想：

> fishbowl 程序不需要知道 DSH 相关信息。相关信息由 DSH 插件提供。DSH 插件类似 MCP 服务器，fishbowl 只通过 HTTP 连接 DSH 插件，然后获取插件可以提供的功能。这样可以让 fishbowl 与 DSH 完全解耦。

### 当前确认的架构原则

- fishbowl 不知道 DSH 包名、`ctx`、内部 Agent/Session API、内部事件名称和版本细节
- DSH 插件负责把 DSH API 转成通用控制协议
- fishbowl 通过能力发现获取当前服务支持的能力
- 协议不能只有普通 Tool，还需要支持：
  - Tools：操作能力
  - Resources：读取能力
  - Events：实时事件
  - Prompts/操作模板：按需支持
- fishbowl 依赖的是通用能力语义，而不是 DSH 专用 API
- DSH 版本差异和兼容逻辑全部封装在 DSH 插件内
- 需要认证、权限、参数校验、审计和版本协商

### 当前建议的能力类别

```text
Agent：list / get / create / resume / dispose / send / inject / steer / cancel
Session：list / get / create / fork / flush / events
Tool：list / schemas / register / restrict / guard / approve / deny / result
Plugin：list / enable / disable / reload
Config：read / patch / schema
Event：subscribe / unsubscribe
Runtime：status / diagnostics
```

## 8. 当前已确认的方向

```text
- fishbowl 必须能够脱离 DSH 独立运行。
- DSH 通过专门插件向 fishbowl 暴露能力。
- fishbowl 不直接依赖 DSH SDK、内部对象和内部文件。
- fishbowl 与 DSH 插件通过 HTTP 或 MCP 风格协议通信。
- DSH 相关信息和版本差异封装在 DSH 插件内。
- fishbowl 通过能力发现动态获取可用能力。
- 协议支持工具、资源和事件，而不仅是工具调用。
- 用户选择支持 DSH 全部能力。
- 本地、同机不同用户、远程部署都需要纳入设计。
- 当前阶段只做需求澄清和资料整理，不开发业务代码。
- 需要同时维护完整对话记录和结构化项目文档。
```

## 9. 尚未最终确认的问题

- 通用协议是采用标准 MCP，还是定义 fishbowl 自有控制协议并兼容 MCP 风格
- DSH 插件与 fishbowl 的连接方向：fishbowl 连接插件，还是插件主动连接 fishbowl Gateway
- 远程认证采用 mTLS、短期 Token、签名请求还是组合方案
- “全部能力”中哪些是默认开放，哪些需要管理员显式开启
- DSH 是否已有足够正式的 API 支撑插件管理、配置管理和工具管理
- 独立 Runtime 的首个支持渠道是 HTTP、CLI、QQ 还是其他渠道
- 数据所有权是否统一收归独立 Runtime，避免 DSH 插件、QQ 和 CLI 并发写账本
## 10. 用户：询问标准 MCP 与自有协议的优缺点

用户询问两种方法各自的优缺点：

1. 直接采用标准 MCP
2. 定义 Fishbowl 自有控制协议，并兼容 MCP 的 Tool/Resource/Event 模型

本轮比较结论见 `architecture-decisions.md` 的“协议路线比较”部分。

## 11. 用户：按照建议采用协议路线

用户确认按照建议采用：

- Fishbowl Control Protocol 作为 Fishbowl 与 DSH Control Plugin 之间的内部主协议
- 后续可提供 MCP Compatibility Gateway
- 标准 MCP 作为兼容出口，而不是 Fishbowl 内部完整 DSH 控制协议

该决策已同步到 `requirements.md` 和 `architecture-decisions.md`。
## 12. 用户：确认 DSH 插件主动连接、Fish 作为思考主体

用户提出以下要求：

1. DSH 插件主动连接 Fish。用户在 DSH 中对话时，不调用 DSH 大模型，而是由 DSH 插件通过 HTTP 把消息发送给 Fish；Fish 思考完成后，再把回复发送回 DSH。
2. 连接方式可以支持多种方式。
3. 账本和状态全部归属 Fish。
4. 暂不实现 DSH 全部功能，先实现当前已经知道、能够确认的功能。

本轮结论：整体架构可行，但需要专项验证 DSH 的模型调用前拦截、外部 assistant 消息回灌、插件代为调用工具以及 DSH UI 展示结果等能力。
## 13. 用户：Fishbowl 是否需要自己实现 Agent Runtime

用户询问：如果 Fishbowl 作为独立思考主体，是否需要自己实现 ReAct loop、model provider 和其他 Agent 功能。

本轮结论：原则上需要。Fishbowl 不能把核心思考流程继续依赖 DSH Agent loop；至少要自有模型调用端口、Agent/Reasoning loop、工具调用编排、上下文/记忆组装、取消/超时和状态记录。DSH 插件只负责宿主接入与能力转发。
## 14. 用户：需要完整审计能力

用户补充要求：Fishbowl 必须具有审计功能，所有操作都要有迹可循。

本轮结论：审计应作为核心非功能需求，而不是附加日志。需要覆盖 Fishbowl、DSH Control Plugin、Agent/Model、工具、权限、状态/账本、连接和错误等操作，并支持关联请求、查询追踪、敏感字段脱敏和可靠留存。
## 15. 用户：补充需要注意和开发的内容

用户询问：除现有需求外，还有哪些地方需要注意，或者需要开发。

本轮将从 DSH 可行性、Agent Runtime、协议、审计、安全、数据一致性、部署、可靠性、隐私和测试等方面补充风险与开发清单，并区分首期必须项和后续项。

## 16. 用户：鱼塘设置页面、鱼的视觉范围与交流

用户原话：

> 这个鱼塘程序应该有一个设置页面，可以设置每条鱼的状态，还有如果开启了2条鱼，那么这两个鱼可以设置 视觉范围， 可以看到其他的鱼，可以和其他的鱼进行对话交流

新增需求：独立设置页、逐鱼状态设置、多鱼同时开启、可配置视觉范围和鱼间对话。

助理建议（未批准）：区分权限可见与空间视野；每条鱼保持独立记忆和情绪，可见不等于共享私密记录；交流由 Fish 调度并审计，自动交流设置终止条件。下一步优先澄清“视觉范围”是可见对象名单、空间距离还是两者结合。

详细需求与待确认问题见 `pond-interaction-requirements.md`。

## 17. 用户：接入数量、消息排队、会话绑定与记忆范围

用户原文：

> 当前还缺少几个关键规则：
> 一个 Fish 个体能否同时连接多个 DSH 会话？
> 先暂时只允许一个接入，后期可能会升级成多个
> DSH、QQ 和其他入口是否共享同一个个体？
> 允许不同的远程程序连接，比如dsh，qq，但每一个比如 dsh，只能接一个
> 同一个体收到两条消息时，是排队、打断，还是并行？
> 当前选择排队
> 新建 DSH 会话是新建个体，还是继续原有个体？
> 目前一个dsh会话只允许连接一条鱼
> 谁可以看到哪些记忆？
> 鱼可以看到全局记忆

结构化规则见 `connection-session-rules.md`。全局记忆的边界尚待确认；一个 DSH 会话只能绑定一条鱼，并未决定新会话是否自动创建个体，不能据此推断自动出生规则。

助理本轮反馈：按每条鱼每类远程程序一个接入、不同类型可同时接入、每条鱼消息统一排队理解。优先澄清全局记忆是该鱼跨渠道的全部记忆、鱼塘所有鱼的全部记忆，还是独立共享记忆区。

## 18. 用户：确认视觉范围方案 1

用户原话：

> 视觉范围： 1

确认内容：视觉范围采用可见对象名单，逐鱼设置能看到哪些其他鱼，不采用空间位置和距离。该回复明确针对视觉范围，不是对上一轮全局记忆访问方案的选择。

助理反馈：已记录视觉范围选择；全局记忆范围仍待确认，下一步澄清记忆范围。

## 19. 用户：确认全局记忆方案 1

用户原话：

> 鱼可以看到全局记忆”具体指哪种？
> 1

确认内容：每条鱼可以召回自己跨 DSH、QQ 等全部入口的记忆，不直接读取其他鱼的记忆。视觉范围名单不授予对方记忆的读取权限。

助理反馈：已同步接入规则和鱼塘交互需求；跨渠道记忆可用范围与对不同聊天对象的披露范围应分开，披露策略尚待确认。未开发代码。

## 20. 用户：继续补充待考虑事项

用户询问：在已有独立 Fish Runtime、DSH Control Plugin、多鱼、视觉范围、跨渠道自身记忆、排队和审计规则后，还有哪些事项需要考虑。

本轮将补充影响架构和首期范围的待确认问题，重点包括记忆披露、鱼间交流、会话生命周期、消息队列、审计隐私、模型预算、故障恢复和设置页权限。

## 21. 用户：请求核实 DSH 闭环并确认社交等规则

用户原文完整保存在 `confirmed-social-and-runtime-rules.md` 的“用户原文”部分。

确认：披露与检索分离；允许鱼主动交流、双向可见、多轮、每日次数或数量限制、独立 Token 预算、交流入各自记忆、用户旁观与插话；设置页和排队规则采用前述建议。

DSH 只读调查见 `dsh-feasibility.md`：检查了 PLUGIN.md、HOST.md、当前 host.js 和 scripts；旧安装路径不可访问、无 dsh 命令。现有 inject/followup 是输入能力，尚不能证明外部 assistant 输出闭环。可继续核实外部 Agent 后端、模型 Provider 代理、拦截加合法结果提交三条路线。未运行 DSH、未编写代码。

助理反馈：断线处理此前未给出唯一默认值，本轮提出不自动回退 DSH 模型、断线保存结果重连补发、未知副作用不盲重试的建议，尚待确认。真实运行验证需要可访问的当前版 DSH 契约/源码或实例。

## 22. 用户：提交并推送需求资料

用户原话：

> 暂时就这些了，先将这些提交，推送远程

> https://github.com/fandreamfish/fishbowl.git 仓库是这个， 放到这个仓库

授权目标：将本次需求讨论资料提交并推送到指定仓库，保留远程已有内容。

执行情况：当前工作区没有 .git 元数据；尝试在会话临时目录克隆指定远程仓库失败。Git clone 和 git ls-remote 均报告无法连接 github.com:443，Test-NetConnection 也返回 TcpTestSucceeded=False。没有创建提交，没有推送，也未修改系统代理或 Git 配置。待网络恢复后继续发布。

## 23. 用户：重试推送

用户原话：

> 再试一下

本次 git ls-remote 成功，远程默认分支为 main；已成功克隆仓库，克隆工作树干净，远程未有 docs/project-records 目录。准备仅提交本次 9 份需求资料。最终提交和推送结果以 Git 提交记录和远程分支为准。
