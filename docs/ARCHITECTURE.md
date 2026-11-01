# 架构分析：核心 / 能力 / 工具 / 可抽取模块

> 基于当前代码（m35 之后）实测的依赖关系，不是设想。
> 目标：把"她"和"宿主"分开，把"能力"和"编排"分开，让每一块都能单独测试、单独搬走。

## 0. 结论先行

| 层 | 现在实际是什么 | 应该是什么 |
|---|---|---|
| **核心**（domain） | `src/core/engine.ts`（评价→情绪→偏置）、`types.ts`、`growth.ts` | 纯函数，零 IO，可单独发布成 `@fishbowl/affect` |
| **个体**（entity） | `creature.ts` + `store.ts` + `tenancy.ts` + `signals.ts` | 事件溯源实体：账本、投影、住处、不变量 → `@fishbowl/being` |
| **能力**（capability） | `packages/memory`（已抽出）、`lib/browse/*`、`lib/voice.js`、`lib/journal.js`、`lib/appraiser.js`、`lib/llm.js` | 各自独立、只通过端口拿 IO → `@fishbowl/memory`、`@fishbowl/bilibili`、`@fishbowl/voice` 等 |
| **编排**（use case） | 没有独立层，全挤在 `collector.js`（18 个依赖）和 `life.js`（11 个） | `TurnPipeline`、`WakeUseCase`、`DiaryUseCase`、`BrowseUseCase` |
| **工具**（tool） | `memory/tool.js`、`browse/tool.js`、`browse/speak-tool.js` | 保持薄：参数校验 + 调 use case，不写业务 |
| **适配器**（adapter） | `host/dsh.js`（唯一碰 DSH，291 行）、`bridge-qq/lib/*` | 两个适配器实现同一组端口；QQ 桥不该 import `plugin/lib` |
| **界面** | `lib/ui-route.js`（625 行，17 依赖）+ `client.js`（1236 行） | HTTP 资源层 + 独立前端 bundle；业务全部下沉 |
| **配置** | `config.js` + `fishcfg.js`（按鱼覆盖已做） | 独立的 `Settings` 服务，谁都能读，但只有一处写 |

**最大的三个结构问题**：

1. `collector.js` 是上帝对象：评价、记忆、注入、回忆、许可、日记、纸条、请求、承诺、活动、改名、跨会话同步全在里面。
2. `ui-route.js` 既做 HTTP 又做业务（写配置、扫评论、触发浏览、改半衰期），且知道几乎每个模块。
3. `bridge-qq/lib/pipeline.js` 直接 import `plugin/lib/*`（7 条边）——第二个宿主被迫依赖第一个宿主的内部结构。

## 1. 现状实测

### 1.1 依赖边（目录级，数字是 import 次数）

```
plugin/lib -> plugin/lib   49   ← 内部强耦合（collector/ui-route 各拖一大串）
plugin/lib -> core         25
memory     -> memory       34
core       -> core         16
plugin     -> plugin/lib   12
plugin/lib -> memory        4
bridge     -> plugin/lib    7   ← 违反分层
plugin/lib -> host          3   ← 业务层直接拿宿主
```

### 1.2 单个文件的依赖数（前几名）

| 文件 | 行数 | 直接依赖 | 它知道的东西 |
|---|---|---|---|
| `plugin/lib/collector.js` | 473 | 18 | 评价器、记忆、注入、回忆、许可、日记、纸条、请求、承诺、活动、改名、浏览、宿主 |
| `plugin/lib/ui-route.js` | 625 | 17 | 配置、绑定、记忆视图、浏览运行时/风控/登录/评论、节律、改名、宿主 |
| `plugin/index.js` | 90 | 13 | 组合根（合理，但说明装配面很大） |
| `plugin/lib/life.js` | 268 | 11 | 调度、联系配额、自处、浏览、评论扫描、情绪 |
| `src/core/creature.ts` | 328 | 6 | 情绪、事件、住处、日记、承诺、活动、信号 |
| `bridge/lib/pipeline.js` | 60 | 7 | 评价器、记忆、注入、声音、配置 |

### 1.3 已经做对的地方

- `packages/memory` 已经是一个真正的独立模块：零宿主依赖，自带测试与配置校验。
- `host/dsh.js` 是唯一直接碰 DSH API 的文件（除了 index.js 的 `inject` 声明）。
- 配置已经做到"每条鱼独立"，`fishcfg.js` 是唯一读 `config.json` 的地方。
- 账本只追加、投影可重算、`creatures/<id>/` 自包含——这三条不变量是重构的安全网。

## 2. 分类规则（怎么判断一个模块属于哪层）

| 问 | 是 | 否 |
|---|---|---|
| 有 IO（文件/网络/时钟/宿主）吗？ | 能力或适配器 | 核心 |
| 知道"哪条鱼"吗？ | 个体 / 编排 | 核心 |
| 会被两个以上宿主复用吗？ | 独立包 | 适配器内部 |
| 只做参数校验与格式化吗？ | 工具 | 编排 |
| 同时知道记忆、浏览、日记、宿主吗？ | **该拆了** | — |

## 3. 目标架构（六边形 + 事件驱动）

```
                 ┌─────────────────────────────┐
   DSH 事件流 ───▶│  adapter-dsh (host/dsh.js)  │
   DSH 工具调用 ─▶│  adapter-dsh/tools          │
   DSH HTTP ─────▶│  adapter-dsh/http (ui-route)│──▶ ui (client bundle)
   QQ 消息 ──────▶│  adapter-qq (bridge)        │
                 └──────────────┬──────────────┘
                                │ ports: Llm · Clock · Store · Host · Events
                 ┌──────────────▼──────────────┐
                 │  app（用例）                 │
                 │  TurnPipeline / Wake / Diary │
                 │  Browse / Comment / Notify   │
                 └───┬──────────┬──────────┬───┘
                     │          │          │
          ┌──────────▼──┐ ┌─────▼─────┐ ┌──▼──────────┐
          │ memory      │ │ being     │ │ affect      │
          │ (独立包)    │ │ (独立包)  │ │ (纯函数包)  │
          └─────────────┘ └───────────┘ └─────────────┘
                     │          │
          ┌──────────▼──────────▼──────────┐
          │ 能力包：schedule · bilibili    │
          │ voice · journal · appraiser    │
          └────────────────────────────────┘
```

**依赖方向规则（CI 可检查）**：

1. `affect` 不 import 任何东西（只有 `util`）。
2. `being` 只能 import `affect`。
3. `memory` 只能 import `affect`（情绪类型）与自己的子模块。
4. 能力包只能 import `affect` / `being` 的**类型**与端口接口，不 import 适配器。
5. `app` 可以 import 所有包，**但不能 import 任何 adapter**。
6. adapter 只能 import `app` 与端口定义；两个 adapter 之间零依赖。
7. `ui` 只通过 HTTP JSON 与 adapter 通信。

## 4. 模块清单与职责

### 4.1 `@fishbowl/affect`（核心，纯函数）

| 文件 | 职责 |
|---|---|
| `types.ts` | `Affect / Appraisal / Bias / Temperament / HalfLives` |
| `engine.ts` | `applyAppraisal` `applyElapse` `applyAbsence` `applyContact` `applyRepair` `toBias` `inDeadband` |
| `growth.ts` | 成长率、分层间隔、遗忘窗口 |

对外只有一个函数式 API；没有类，没有状态。

### 4.2 `@fishbowl/being`（个体实体）

| 文件 | 职责 |
|---|---|
| `store.ts` | 只追加账本、投影缓存、outbox、meta |
| `creature.ts` | 事件重放、`affectNow`、`longingAt`、住处读写、日记/纸条/请求/承诺/活动 |
| `tenancy.ts` | 工作区/会话住处互斥 |
| `signals.ts` | 跨会话的 grant / wake 记录 |

约束：`being` 不知道记忆（那是 memory 包的事），也不 import 宿主。迁移时先把 `creature.ts` 里记忆相关的残留清干净（已经删掉了 `memorySummary` 等旧方法）。

### 4.3 `@fishbowl/memory`（已独立）

保持现状：`ledger / events / records / consolidate / summarize / recall / render / embed / lock / config`。
唯一要改的：把 `Memory` 构造参数从"一个 dir"改成"Store 端口"，让两个宿主共用同一个账本实现。

### 4.4 `@fishbowl/schedule`（能力）

`Scheduler`（清醒节律）+ `ContactGate`（配额）+ `selfTime` 判断。
输入只有时间与配置，输出"该不该醒、该不该开口"，不碰宿主。

### 4.5 `@fishbowl/bilibili`（能力，无宿主）

`core/browse.ts`（计划/窗口/日键）+ `plugin/lib/browse/client.js`（HTTP、风控节奏）+ `risk.js` + `store.js`（浏览记录）+ `comment.js`（评论/回复）。
不含 `tool.js / speak-tool.js`（那是 DSH 适配层）与 `runtime.js` 里的宿主相关部分。

### 4.6 `voice` / `journal` / `appraiser`（能力，纯）

`voice.js`（语域规则）、`journal.js`（日记/纸条/请求的提示词与解析）、`appraiser.js`（评价器实现：scripted / deepseek）、`llm.js`（HTTP 调用）。
它们只依赖配置，不依赖个体或宿主。

### 4.7 `app`（用例编排，新层）

| 用例 | 输入 | 输出 |
|---|---|---|
| `TurnPipeline` | 一轮转录、评价、当前 affect | 新的账本事件、注入文本、异步任务队列 |
| `WakeUseCase` | 时间、鱼的配置、账本摘要 | `contact` / `self` 两种唤醒意图 |
| `DiaryUseCase` | 日期、当天转录、窗口配置 | 日记文本 + 落账 |
| `BrowseUseCase` | 配置、风控状态 | 一条素材 / 拒绝理由 |
| `CommentUseCase` | 视频、评论文本、登录态 | 发表结果 / 拒绝原因 |

用例层**不直接调用模型**：模型通过 `Llm` 端口传入；测试时替换成脚本。

### 4.8 adapter

| 适配器 | 职责 |
|---|---|
| `adapter-dsh/host` | `session/event`、`agent/created`、注入、唤醒、工具注册、路由、标题、服务 |
| `adapter-dsh/tools` | 三个工具的 JSON Schema 与薄封装 |
| `adapter-dsh/http` | 把用例暴露成 REST：fish / config / memory / browse / diary |
| `adapter-qq` | OneBot 事件 → `TurnPipeline`；不 import `plugin/lib` |

### 4.9 `ui`

设置页前端：只认 HTTP JSON。把 1236 行的 `client.js` 按页面拆组件（列表 / 状态 / 住所 / 作息 / 上网 / 人设 / 记忆）。

## 5. 交互时序

### 5.1 一轮对话（不含模型调用的部分都在 1ms 级）

```
DSH ──user/message──▶ adapter-dsh ──▶ app.TurnPipeline.begin
                                            │ 记录缓冲区
DSH ──turn/end─────▶ adapter-dsh ──▶ app.TurnPipeline.finish
   ├─ Llm(appraise)            → Appraisal
   ├─ affect.applyAppraisal    → 新 Affect（peak）
   ├─ being.append('turn')     → 账本
   ├─ memory.observe(turn)     → 记忆账本
   ├─ memory.render(...)       → 注入文本
   ├─ adapter.inject(text)     → 下一轮上下文
   └─ async: memory.tick · diary · note · request · commitment
```

### 5.2 主动醒来

```
adapter timer ─▶ app.WakeUseCase.tick
   ├─ schedule.inWindow? / 配额
   ├─ being.longingAt(now) / 未完成承诺
   ├─ 有由头 → adapter.wake(舞台提示)
   └─ 没由头 → 只写 wake-state
```

### 5.3 浏览 / 评论

```
tool ─▶ app.BrowseUseCase.run
   ├─ schedule.window / 日配额 / 风控冷却
   ├─ bilibili.client.home|search|view
   ├─ bilibili.store.record
   └─ 返回"她看到的一段"，工具只做格式化
```

### 5.4 日记

```
turn/end 或 agent/created ─▶ app.DiaryUseCase.maybeWrite
   ├─ 窗口内且今天没写 → 写今天（整天转录）
   └─ 昨天没写 → 补昨天
```

## 6. 可抽取清单（按"能不能独立发布"排）

| 包 | 现在的位置 | 抽取难度 | 依赖 |
|---|---|---|---|
| `@fishbowl/affect` | `src/core/{types,engine,growth,util}.ts` | 低（纯函数） | 无 |
| `@fishbowl/being` | `src/core/{store,creature,tenancy,signals,commitment,activity}.ts` | 中（被大量 import） | affect |
| `@fishbowl/memory` | `packages/memory` | 已完成 | affect（类型） |
| `@fishbowl/schedule` | `src/core/{scheduler,contact}.ts` | 低 | 无 |
| `@fishbowl/bilibili` | `src/core/browse.ts` + `lib/browse/{client,risk,store,comment}.js` | 中（去掉 `runtime.js` 里的宿主胶水） | 无 |
| `@fishbowl/voice` | `lib/voice.js` | 低 | 无 |
| `@fishbowl/journal` | `lib/journal.js` | 低 | 无 |
| `@fishbowl/app` | 新层（从 collector/life 抽出） | 高（要拆上帝对象） | 以上全部 + 端口 |
| `@fishbowl/adapter-dsh` | `host/dsh.js` + `index.js` + tools | 中 | app |
| `@fishbowl/adapter-qq` | `packages/bridge-qq` | 低（已经独立成进程） | app（改成不直接依赖 plugin/lib） |
| `@fishbowl/settings-ui` | `client.js` | 中（前端拆分） | HTTP |

## 7. 重构路线（每一步都可独立发布、测试全绿）

| 阶段 | 动作 | 验收 |
|---|---|---|
| R1 | 抽 `@fishbowl/affect`，`core` 其余文件改为 re-export | 测试不变、依赖方向正确 |
| R2 | 抽 `@fishbowl/being`，清掉 creature 里的记忆残留 | 搬迁/重算两条不变量测试通过 |
| R3 | 抽 `@fishbowl/schedule`、`@fishbowl/voice`、`@fishbowl/journal` | 纯函数测试覆盖 |
| R4 | 建 `app/TurnPipeline`，把 collector 拆成 6 个步骤函数 | 端到端 e2e 行为不变 |
| R5 | 建 `app/WakeUseCase`，life.js 只留定时器 | 唤醒集成测试通过 |
| R6 | 建 `app/DiaryUseCase`，collector 只调用 | 窗口/补写测试通过 |
| R7 | `ui-route` 拆资源与处理函数；业务调用 app | 现有 HTTP 测试全绿 |
| R8 | bridge 改为依赖 `app` 与端口 | 桥测试全绿 |
| R9 | 加依赖方向检查脚本到 CI | 违规即失败 |

## 8. 重构中不能丢的东西

1. 账本只追加；投影可删可重算（搬迁测试）。
2. 情绪是纯函数：同账本 + 同时刻 → 同结果。
3. 个体 = 一个目录：`creatures/<id>/` 自包含（meta、log、config、outbox）。
4. 配置按鱼独立，默认值可继承。
5. 密钥/登录态永不进仓库。
6. 插件零依赖（`node:` 内置）。
7. 宿主回调绝不外抛；工具失败只影响自己。

## 9. 风险

- **大爆炸重构**：不要。按 R1–R9 每步单独提交、单独打标签。
- **行为漂移**：以现有 7 套测试 + 2 条不变量作为契约；每步前后跑。
- **性能**：用例层要注意每轮 LLM 调用数（当前评价 1 次 + 记忆 0–3 次）。
- **兼容旧账本**：新模块必须容忍未知事件类型（`buildView` 已如此）。
- **QQ 桥与 DSH 并发写**：迁移到 `Store` 端口时顺便统一写锁，否则双进程写同一 `log.ndjson` 的风险仍在。

## 10. 能力开关（m37）

能力是**按鱼**配置的，不是插件级：

```yaml
# creatures/<id>/config.json
capabilities:
  browse: true        # 上网（工具 + 设置页的「上网」页）
  speak: true         # 在 B 站说话
  memorySearch: true  # 翻自己的记忆
```

三条落地规则：

1. **工具注册**：激活时和配置保存后重新计算——如果所有鱼都关掉某个能力，对应的工具**根本不注册**（不是注册了再拒绝）。
2. **调用兜底**：只要还有鱼开着，工具就存在；调用时按"当前这条鱼"的配置再判一次，关了就回一句"我现在不上网。"。
3. **界面**：设置页的页签按能力过滤（关掉 browse 就没有「上网」页），状态页提供开关。

这带来一个架构上的好处：能力包（`@fishbowl/bilibili` 等）可以按需加载，宿主适配层只需知道"注册哪些工具"，不需要知道能力内部的实现。