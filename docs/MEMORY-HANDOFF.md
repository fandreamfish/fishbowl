# 交接 Prompt：讨论「把记忆系统抽取成独立模块」

> 把下面整段粘到新会话里，作为讨论的起点。

---

## 背景

在读的是 **fishbowl**（`D:\fish-memory`）：一个「养 AI」的系统。核心主张：人格不是配出来的，是从事件里长出来的；记忆是底料，人格是派生。

- 设计文档：`DESIGN.md`（五条公理、决策日志 #1–#31）、`ROADMAP.md`、`docs/STATE.md`、`docs/HOST.md`
- 当前阶段：M0–M15 完成；宿主是 **DeepSeek Harness 0.2.1-rc.5**（插件形态，`packages/plugin`）
- 最近的重构（M11）：**宿主接线全部收进 `packages/plugin/host/dsh.js`**，核心与逻辑层已与宿主解耦
  - `src/core/` 1141 行，零 DSH 依赖
  - `packages/plugin/lib/` 1574 行，不碰 ctx/agent
  - `host/dsh.js` 223 行，唯一碰 DSH 的地方

## 代码地图

```
src/core/           纯逻辑（无宿主依赖）
  types.ts          事件与个体类型
  engine.ts         情绪引擎（评价→情绪→6 旋钮）
  creature.ts       个体：fold、记忆摘要、权重、承诺、日记/纸条/请求
  store.ts          事件日志 + 投影缓存（creatures/<id>/）
  growth.ts         成长率分层、记忆窗口、证据门槛
  consolidation.ts  巩固触发 + 解析 + 去重
  selfmodel.ts      自我认知触发 + 解析（证据门槛）
  recall.ts         话题匹配（中文二元组 + 英文词）
  commitment.ts     承诺/违诺解析
  journal.ts        日记/纸条/请求的提示词与配额
  tenancy.ts        住处互斥与解析
  scheduler.ts / contact.ts / channels.ts   节律、联系配额、通道披露边界

packages/plugin/
  host/dsh.js       FishHost 的 DSH 实现（事件流/注入/唤醒/工具钩子/标题/枚举/HTTP 路由）
  lib/collector.js  回合管道：评价→记录→巩固→自我认知→日记/纸条/请求→注入
  lib/injector.js   状态摘要渲染、最近对话块、回忆块、注入消息形状
  lib/binding.js    会话/工作区 → 个体解析（读 meta.occupancy）
  lib/life.js       清醒节律与主动联系（默认关闭）
  lib/constraints.js 情绪→工具策略（guard/pre-execute，返回 undefined 才是放行）
  lib/ui-route.js   设置页后端（/fishbowl-ui/*）
  client.js         设置页前端（DSH 客户端插件，401 行）
```

## 记忆系统当前实现（讨论对象）

### 1. 存储：事件日志，只追加

`creatures/<id>/log.ndjson`，一行一事件；`projection.json` 是可删可重算的情绪缓存。

事件类型：`episode`（每轮：appraisal + 转录 note）、`semantic`（事实）、`procedure`（教训）、`self`（自我认知）、`commitment` / `commitment-resolved`、`activity`、`identity`（名字）、`diary`、`note`（小纸条）、`request` / `request-answered`、`reinforce`（同一件事被再次提到）、`absence`、`contact`、`repair`、`freeze` / `unfreeze`。

### 2. 巩固（把经历压成认知）

- 触发：`shouldConsolidate` —— 至少隔 2 轮；`episodesSince ≥ 5/(g·rate)` 或 `salienceSince ≥ 0.6/(g·rate)`
- 层级速率：战术 4× / 偏好 1× / 关系 0.5× / 自我 0.1×（`DEFAULT_LAYER_RATES`）
- 一次读最近 8 轮 → 模型输出 JSON：事实（claim + evidence + confidence）、教训（trigger → action）
- **证据门槛**：普通事实 ≥2 条独立证据；关系类（含"我们/信任/承诺/亲密"等）≥3 条
- **去重对全集**：重复的不重新落盘，记 `reinforce`，重量上升

### 3. 自我认知（更慢、更严）

- 间隔 `12/(0.1·g)` 轮（g=1 时约 120 轮），冷却 `max(3, 间隔/2)`
- 证据 <2 条直接丢弃；置信度 = min(1, 证据数/3)
- 注入里自述只来自这一层，不许从情绪数字里编

### 4. 重量与遗忘

```
重量 = 置信度 × (1 + 0.4·ln(1+强化次数)) × 0.5^(ageDays / 半衰期)
半衰期 = 记忆窗口/3；记忆窗口 = max(7, 90/g) 天
```

超过窗口 → **折叠**（不逐条注入，只报"记不清 N 件"），事件原文永远在账本里，可按话题翻出。

### 5. 注入（她实际看到的）

每次状态可见变化（stateKey 量化到 0.1 指纹）注入：名字、情绪（效价/唤醒/愧疚/想念）、6 旋钮、记得的事（前 3）、教训（前 2）、自我认知（前 2）、未完成承诺（⚠）、一起在做的事、折叠数、待回/已答请求、提示语。

另外两块：

- **打开会话时**：最近 6 轮对话**原文**（≤1500 字），跨会话同一份
- **每句用户消息**：`matchClaims` + `matchTexts`（中文二元组/英文词）匹配全部认知与**全部原始 episode 原文**，命中就注入"（他这句话让你想起：…）"；同一条 10 分钟内不重复

### 6. 跨会话一致性

鱼住在工作区 → 该工作区所有会话解析到同一 creature（同一份情绪/记忆/承诺）。一轮结束后，状态同步注入到同一只鱼的其它活会话。

### 7. 其它记忆体裁

- 日记：一天一篇，模型写"今天发生的事 + 心情"
- 小纸条：一天最多一张，情绪够强时写（|效价|>0.5 或 愧疚>0.3 或 想念>0.4）
- 请求：一天最多一次、一周最多三次；关键词预筛后才调模型；答复进入注入
- 承诺：违诺的 `broken` 不会消失（没翻篇）

### 8. LLM 依赖

巩固、自我认知、日记、纸条、请求、评价器（每轮一次）都调模型（DeepSeek）。每轮大约 1–3 次调用。

## 想讨论的问题

1. **模块边界**：抽成什么形态？
   - 纯库（`memory-core`，宿主自己接存储和模型）
   - 带存储的服务（`memory-service`，HTTP/进程内）
   - 库 + 可选服务（推荐？）
2. **接口**：最小 API 是什么？
   - 现在的事实接口：`observe(turn)`、`consolidate()`、`summary(g)`、`recall(text)`、`recent(n)`、`weight()`、`injectText()`
   - 需要哪些同步/异步语义？常驻缓存？多实例并发写？
3. **存储**：继续用 ndjson 事件日志，还是 SQLite？需要索引/不可变/迁移策略？
4. **检索**：字面匹配（现在）→ 是否引入 embedding / 混合检索？何时值得？成本与延迟？
5. **LLM 依赖**：巩固/自我认知要不要可插拔（本地模型、不同 provider）？失败/超时怎么退避？
6. **注入策略**：固定 3/2/2 的容量是否该改为 token 预算制？跨会话原文注入的边界？
7. **与宿主解耦**：`FishHost` 已抽出 12 个动词（docs/HOST.md），记忆模块是否也要一层 `MemoryHost`（storage + llm）？
8. **必须守住的不变量**：只追加、投影可重算、证据门槛、折叠≠删除、跨会话同源
9. **迁移**：现有 `creatures/` 数据如何无损迁到新模块？schema 版本怎么管？
10. **测试**：纯函数单测（已有一批）+ 无 LLM 的确定性回放（mock 模型输出）怎么做？

## 已知限制（别重复踩）

- 注入有上限：没被巩固、又没被关键词命中的内容不会进上下文（原文在，但"想不起来"）
- 无向量检索，只有字面匹配（二元组），同义词/改写命中率低
- 每轮 1–3 次 LLM 调用，会与主对话争用限流
- 折叠后只能"记不清 N 件"，没有主动回忆工具
- 存储是单写者文件（多实例并发写没解决）

## 运行与测试

```powershell
# 内核
node src/test.ts
# 插件
node packages/plugin/test/unit.test.ts
# 桥
node packages/bridge-qq/test/unit.test.ts
# 激活冒烟
node scripts/m7-apply-smoke.ts
# 看某只鱼的注入摘要
node scripts/probe-memory.ts
```

## 期望产出

先给方案对比（库 / 服务 / 库+服务），再说清接口、存储、检索、LLM 边界的取舍，最后给出迁移与测试计划。不要先写代码。
