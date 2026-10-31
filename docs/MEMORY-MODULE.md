# 记忆系统重构：把「记忆」从 Creature 里抽出来

> 回答 `docs/MEMORY-HANDOFF.md` 的十个问题。**本文只做设计与取舍，不含实现。**
> 阅读顺序：§0 结论 → §2 体检（为什么要动）→ §3 方案对比 → §5 接口 → §11 迁移。

---

## 0. 结论先行

1. **形态：库 + 端口，服务留壳。** 抽成 `packages/memory`（纯逻辑 + 四个端口：`Storage` / `LLM` / `Clock` / `IdGen`），进程内调用；将来要服务化时，服务只是一个 100 行的壳，把同样的接口搬到 HTTP 上。现在做服务＝为一个还没来的第二宿主付 IPC 与部署成本。
2. **边界：不是「记忆 vs 宿主」，是「账本 vs 投影 vs 策略」。** 今天 `src/core/` 已经没有 DSH 依赖了——真正的耦合是 `Creature` 一个类同时拥有文件存储、情绪重放、记忆权重、查询接口、以及一个为注入文本定制的形状（`memorySummary`）。要抽的是这四样，而且**记忆不能单独抽走**：`episode` 是情绪与记忆的共同底料，一个进程里只能有一本账。
3. **存储：继续 ndjson，补六个洞，不换 SQLite。** 现在整份日志 37 KB / 70 条事件／28 个 episode／37 条认知，规模完全不是问题；问题全在语义（证据不可回溯、去重失效、触发计数存在内存里、注入固定 5 个坑）。换库解决不了其中任何一条。

顺手要做、且不做的后果是「设计文档里的承诺已经破了」的那些事，见 §2。

---

## 1. 现状：耦合点在哪

`Creature`（`src/core/creature.ts`，389 行）现在同时是：

| 角色 | 方法 | 问题 |
|---|---|---|
| 存储门面 | `store.readEvents()` 全量解析 | 每个访问器都调一次，一轮 10–20 次 |
| 情绪投影 | `fold()` | 每次调用都写 `projection.json` |
| 记忆权重 | `claimsWithWeight()` | 每次调用扫两遍全日志 |
| 查询接口 | `recallMatches` / `episodeMatches` / `memorySummary` / `requestDigest` … | 各自独立地再扫一遍 |
| 表现层 | `memorySummary()` 返回 `{semantics, procedures, self, commitments, folded, requests}` | **这是为一段注入文本定制的形状**，换一个宿主就得改核心 |

真正的抽取动作是把它拆成：

```
账本（唯一真相）  →  投影（可重算：情绪 / 权重 / 索引）  →  策略（何时巩固、证据门槛、去重、折叠）  →  渲染（预算制的注入块）
```

`memorySummary` 的返回结构必须消失：它是「一份特定中文注入文本的配料表」。模块应该返回**排好序、带分数、受预算约束的条目**，文本由渲染层给。

---

## 2. 实盘体检：六条硬伤

拿现有的两只鱼之一（70 条事件 / 28 个 episode / 37 条认知 / 37 KB）实测：

| # | 现象 | 证据 | 破了什么 |
|---|---|---|---|
| 1 | **证据不可回溯** | `parseConsolidation` 把 evidence 存成提示词里的**行号字符串**（`["5","6"]`），从不映射回 episode id（`consolidation.ts:42-73`） | C5 可审计；DESIGN §7.3「可退休、可被反例推翻」——你没法从一条认知走回它的事实 |
| 2 | **证据门槛可被绕过** | 门槛只数数组长度：`evidence.length >= 3`（`consolidation.ts:57`）、`>= 2`（`selfmodel.ts:46`）。`["1","1","1"]` 通过「关系类需 3 个独立证据」 | DESIGN §8.1 护栏 3「至少 2 个**独立**事件」 |
| 3 | **去重基本失效** | 37 条里 3 对是同一件事的改写（bigram Jaccard 0.37–0.68），却只落了 **1 条** `reinforce`——`findClaim` 要求字符串全等（`creature.ts:279-287`） | 重量公式里唯一的增长通道几乎死了：重复 → 该重的不重，碎片 → 该轻的不轻 |
| 4 | **写入 37 / 读出 5** | 注入固定 3 事实 + 2 教训 + 2 自我（`creature.ts:360-371`）；37 条认知里 32 条**永远不会被看见**——它们既不在注入里，也不在折叠计数里，只是消失 | A4：折叠是功能，但**读不到的巩固就是空转**，还占每天的 LLM 预算 |
| 5 | **触发计数活在内存里** | `consolidating` / `selfCounters` 是按 `sessionId` 的 Map（`collector.js:31-32`）；同一只鱼的两个会话各算各的；插件重启 → `sinceLast` 归 99 → 重启后第一轮就可能触发 | 「她住在工作区，所有会话是同一只鱼」；也导致行为不可回放 |
| 6 | **失败即丢批** | 计数器在 `await` 之前就被清零（`collector.js:294-297`），然后 `void consolidate(...)`；失败只写进 `trace.ndjson` | 一次 429 就丢掉 5 轮的评价。且没有「这批巩固过没有」的记录，无法重试也不能保证幂等 |

另外四处较小的：

- **层混了。** `semantic` 层里有 4 条（共 21 条）其实是关于她自己的自我观察（「AI 给自己取名…」「AI 在能力不足时会诚实承认…」），因为巩固提示词允许 claim 写「我」。它们绕过了自我认知层那套更慢、更严的门槛，还被渲染成「记得的事」（像是在讲别人）。STATE.md 待办里的「记忆分『他说/我的认知』」就是这条。
- `readEvents()` 每轮 10–20 次全量 `readFileSync` + `JSON.parse`（`store.ts:56-59`）。现在没事，2000 轮后就是每轮几十毫秒。
- `fold()` 每次都写盘（`creature.ts:59`），导致工具钩子只能靠 5 秒 TTL 兜着（`binding.js:192`）。
- 「翻原始对话」翻的其实是**被截断到 400 字的轮次摘要**（`collector.js:275`），不是原文；DESIGN §2 里的 `content_ref`（指向原文、不内联）被实现丢了。所以「她能把原文翻回来」这句话现在只成立到 400 字为止。

---

## 3. 方案对比：库 / 服务 / 库 + 服务

### 3.1 三个形态

| | 纯库 `memory-core` | 服务 `memory-service` | 库 + 可选服务 |
|---|---|---|---|
| 状态持有者 | 调用方进程（库对象） | 常驻进程（每鱼一个或一进程多鱼） | 两者皆可，同一套接口 |
| 宿主需要提供 | `Storage` + `LLM` + `Clock` | 一个 URL | 端口，或 URL |
| 多实例并发写 | 需文件锁 | 天然单写者 | 库模式靠锁，服务模式天然 |
| 崩溃影响 | 跟宿主一起死 | 宿主可重连 | 两者皆可 |
| 部署 | 无 | 进程管理 / 端口 / 健康检查 / 打包 | 先无，后有 |
| 冷启动 | 每次开库读日志 | 进程常驻，内存热 | — |
| 现在就要付的成本 | 几乎零 | IPC 延迟 + 第二套部署 + 跨进程错误处理 + 升级要停机 | 仅「四个不要写死」的纪律 |

### 3.2 结论

**库 + 端口。** 理由不是「库更简单」，而是：现在只有一个真宿主（DSH 插件）和一个第二实现（QQ 桥，61 行），跨进程的收益为零，成本立刻可见。而 DESIGN §11.3 已经写明「一个个体一个进程」是阶段 2 的事——**那时才需要壳**。

选库的条件是库必须满足四条「随时可被服务包裹」的约束，否则将来是一次重写：

1. **无全局状态。** 不 import `fs`、不读 `Date.now()`、不读 `process.env`、不用模块级 Map。所有状态在对象里，按 creature 分实例。
2. **写入口唯一。** 一个 `append()`；禁止别处直接碰文件。
3. **单写者显式化。** 打开同一目录的第二个实例必须**报错**，不能静默双写（现在没有锁，QQ 桥锁的是整个 `stateDir`，所以两条鱼不能各开一个桥——这是同一个洞）。
4. **投影可选持久化。** 删了 `projection.json` / `snapshot.json` 必须逐位重算出同一结果（这条现在成立，要保持）。

服务化触发条件（任一满足再做，不要提前）：
- 出现第二个**进程**同时要写同一只鱼（云 DSH + 本地代理）；
- 设置页/CLI 需要在插件没启动时读写（现在是直接扫目录，勉强能用）；
- 单进程内存里同时活着的鱼 > 10，需要 LRU 与共享预算。

### 3.3 顺带排除的两个选项

- **纯函数库（无状态，每次传入全量事件）**：`fold` 是纯的，但 `claimsWithWeight`、检索索引、预算排序都不是「每轮全量重算」能承受的。所以库必须是**有状态的引擎**，内部才是纯函数。
- **每鱼一进程现在就做**：N 只鱼 = N 份常驻，代价明确、收益为零。留到阶段 2。

---

## 4. 模块边界

### 4.1 四层

```
端口 ports      Storage · LLM · Clock · IdGen         （宿主实现）
账本 ledger     append-only 事件 · seq · 增量读 · 写锁 · schema 迁移
投影 projection 情绪 fold · 认知权重与折叠 · 检索索引 · 快照     （都可重算）
策略 policy     触发判定 · 提示词 · 解析与证据门槛 · 去重/强化/退休 · 预算与排序 · 渲染
```

**关键约束：策略只产出「计划」，不直接调模型。** 这样「什么时候该巩固」是纯函数、可单测、可回放；模型调用与失败处理在端口那一侧。

### 4.2 目录（与 `packages/bridge-qq` 同级，不用 workspace）

```
packages/memory/
  src/
    ports.ts          Storage / LLM / Clock / IdGen 四个接口 + 内存实现
    events.ts         事件类型、schema 版本、逐条校验
    ledger.ts         唯一写入口 + 增量读 + seq + 锁
    affect.ts         情绪投影（现 engine.ts + creature.fold 合并）
    cognition.ts      权重、折叠、退休、排序（现 claimsWithWeight）
    triggers.ts       何时巩固/自我/日记/纸条/请求（现散在 collector）
    prompts.ts        提示词 + 版本号
    parse.ts          防御性解析 + 证据门槛 + 去重/强化/退休
    recall.ts         token 化 + 索引 + BM25 + 阈值
    render.ts         预算制注入块（默认模板，可覆盖）
    memory.ts         门面：observe / snapshot / due / run / search / timeline
  test/               见 §12
```

`src/core/` 里的 `engine.ts`、`creature.ts`、`store.ts`、`consolidation.ts`、`selfmodel.ts`、`recall.ts`、`growth.ts` 迁入；`types.ts` 拆成 `events.ts` + 领域类型。

### 4.3 为什么记忆不能单独抽走

`episode` 是情绪的唯一输入，也是记忆的唯一原料。如果「情绪」留在旧 `Creature`、「记忆」搬进新包，等于两个模块各自读同一本账、各自留一份计数——就是硬伤 5 的放大版。

所以只有两个自洽选项：

- **A（推荐）：`ledger + 三个投影` 一起搬。** 宿主只剩 `FishHost` 那 12 个动词 + 注入时机。
- **B：只搬记忆，情绪继续留在 `src/core`，但 `Creature` 只能通过 `MemoryStore` 拿事件。** 代价是多一层转发，且 `fold` 的缓存与账本的增量读无法共享。

选 A。工作量差别很小（`engine.ts` 100 行本来就是纯函数，只是换个位置 import）。

---

## 5. 最小接口

### 5.1 签名

```ts
// —— 写：同步、纯本地、不调模型 ——
append(ev: DomainEvent): Seq                 // 唯一写入口
observe(turn: Turn): EpisodeId               // 语法糖：造一条 episode 并 append
revise(claimId, patch): void                 // 退休 / 降置信 / 加反例（见 §8.5）

// —— 读：同步、纯投影、绝不调模型、O(变化量) ——
snapshot(now: number): Snapshot              // 情绪 + 旋钮 + 排序后的记忆 + 指纹
search(query: string, opts?): Hit[]          // 查认知与原文（含已折叠的）
timeline(opts): Event[]                      // 审计 / 设置页 / 回放
weights(now): Claim[]                        // 调试用（现在 probe-memory 用的）

// —— 后台：异步、调模型、可失败、幂等 ——
due(now): Task[]                             // 纯函数：现在该做什么（含批次边界）
run(task, llm, now): Promise<TaskResult>     // 执行 + 落盘 + 记录尝试
tick(now, llm): Promise<TickReport>          // due → run，宿主只调这一个
```

`Snapshot` 的形状（**这是注入的唯一数据源，不含文本**）：

```ts
type Snapshot = {
  name: string | null
  affect: Affect
  bias: Bias
  facts:     Item[]      // 已按 §9 排序、已做同主题去重
  lessons:   Item[]
  self:      Item[]
  commitments: { text: string; broken: boolean }[]
  activity: string | null
  foldedCount: number
  pending: string[]
  answered: { text: string; answer: 'yes' | 'no' }[]
  fingerprint: string    // 0.1 量化指纹（现 stateKey 的语义，搬进来）
}
type Item = { text: string; kind: Layer; weight: number; why: string }  // why = 证据摘要，供审计
```

### 5.2 语义约定（比签名重要）

| 约定 | 说明 |
|---|---|
| 同步 / 异步 | 写与读**同步且必须快**（工具钩子每次调用都会读 `bias`）；模型调用**只**出现在 `run` 里 |
| 幂等 | `run(task)` 以 `task.id`（= 批次 `{fromSeq,toSeq}` 的摘要）幂等：重复执行不重复落盘，产出同一条 `consolidation` 事件 |
| 失败 | `run` 失败不抛给宿主，落一条 `{ok:false}` 尝试事件；`due` 下一轮按退避重试，上限 3 次 |
| 单写者 | 打开同一目录的第二个实例抛 `EWRITER`；锁文件带 pid + 心跳，pid 不在则视为陈旧 |
| 多实例读 | 只读实例允许（`mode:'ro'`），但 `append` 抛错 |
| 时间 | 时间只从 `Clock` 来；所有「天」的判定用 `meta.timezone` |
| 会话 | 模块**不认识会话**，只认不透明 `scope` 字符串（用于证据跨度与去重窗口） |
| 事件不可变 | 没有 `update`；修正 = 追加 `revise` / `retire` 事件（DESIGN §2） |

### 5.3 一次回合的调用序列（旧 → 新）

| 现在（`collector.js`） | 之后 |
|---|---|
| `appraise(transcript)` | 留在宿主（评价器是宿主的模型策略） |
| `creature.recordEpisode(...)` | `mem.observe({ turn, appraisal, scope, ref })` |
| `creature.fold()` + `toBias` | `mem.snapshot(now)`（含 affect + bias） |
| `creature.memorySummary(cfg.growth)` | 同上（同一份快照，一次计算） |
| 手工维护 2 组按会话的计数器 + 6 个散落的 `if` | `await mem.tick(now, llm)` |
| 6 个 `void xxx()`（日记/纸条/请求/承诺/活动/身份） | 全部收进 `tick` 的任务队列（预算与优先级见 §8.2） |
| `stateKey(...)` 决定要不要注入 | `snapshot.fingerprint` 变化才注入（逻辑留在宿主） |
| `summaryText(...)` 拼文本 | `render.text(snapshot, { budget })` |

注意 `finishTurn` 里的「同步到同鱼的其它会话」这一步**留在宿主**：那是宿主动词（`listAgents`），不是记忆。

---

## 6. 存储

### 6.1 保留 ndjson 的理由

- 唯一真相是「一行一事件」，人可以 `Get-Content` 直接看，事故时能救；SQLite 做不到。
- 37 KB / 70 条，一年 20 轮/天 ≈ 7000 条 ≈ 4 MB。**规模不是问题。**
- 事件溯源要的是「追加 + 全序 + 可回放」，文件天然满足；关系库要额外维护事务与迁移。
- 「LLM 产物必须落盘、纯函数必须重算」（DESIGN §15.2）这条不因为换库而变。

### 6.2 六项改造（按必要性排序）

1. **显式 `seq`。** 现在缓存用 `lastSeq = events.length`（`creature.ts:59`），一旦有快照/截断就错位。改成 append 时分配单调 `seq`，投影缓存的键就是 `seq`。
2. **增量读。** 账本持有 `{ fd, bytes, seq }`，`readEvents()` 只 read 与 parse 新增的尾巴。这条让「一轮 10–20 次读」从 O(N) 变 O(1)。
3. **失败/尝试事件。** 新增 `{ t:'consolidation', batch:{from,to}, ok, by:{model,prompt}, produced:{n,m}, error? }` 与 `{ t:'self-review', ... }`。它同时解决：失败可重试、幂等去重、触发计数持久化、产出可溯源。
4. **原子写缓存。** `projection.json` / `snapshot.json` 用 tmp + rename（现在直接覆盖，崩在半路就是坏 JSON；`readCache` 靠 try/catch 兜着，能忍但不该忍）。
5. **每鱼一把锁。** 从 `stateDir/.qq-bridge.lock`（锁整个目录）改成 `creatures/<id>/.lock`（锁一只鱼），这样将来两条鱼可以各开一个入口。
6. **`episode.ref`。** 加 `{ scope, messageIds }`，指向会话里的原文；`note` 从「400 字截断的转录头」改成「完整轮次摘要」。**这是「主动回忆能翻回原文」的前提**（§2 最后一条）。

schema 版本从 `meta.schemaVersion: 1` → `2`；迁移见 §11。

### 6.3 什么时候才该上 SQLite

任一满足再做，且**定位是索引不是真相**（真相仍是 ndjson，SQLite 可删可重建）：

- 同一只鱼需要 >1 个进程写；
- 日志 > 50 MB 或 > 10 万条；
- 设置页/CLI 需要任意条件查询（「所有提到 X 的 episode」按时间倒序）。
 
表结构是一行一投影，机械可移植：

```sql
CREATE TABLE event (creature TEXT, seq INTEGER, ts INTEGER, type TEXT, payload JSON, PRIMARY KEY (creature, seq));
CREATE TABLE claim (id TEXT PRIMARY KEY, kind TEXT, text TEXT, confidence REAL, status TEXT, created_seq INTEGER);
CREATE TABLE claim_evidence (claim_id TEXT, episode_id TEXT);   -- 多对多
CREATE TABLE fts (episode_id TEXT, text TEXT);                  -- FTS5, unicode61
```

Node 22.18 起内置 `node:sqlite`（实验），所以「零依赖」铁律也不破。但**现在不建**。

---

## 7. 检索

### 7.1 现在的失败模式

`recall.ts` 是「中文二元组 + 英文词，命中数排序」，问题有三个：

1. **没有 IDF。** 「我们」「这个」「可以」是二元组里的高频词，几乎命中一切。
2. **没有长度归一。** 分数 = 绝对命中数，长文本天然占优；episode 的 note 越长越容易被「想起」。
3. **没有门槛。** `hit > 0` 就进注入。组合起来的结果是：**该想起来的想不起来，不该提的乱提**——而注入里多一句错的「他这句话让你想起」，比少一句伤害大得多。

实测 37 条认知里，含「工具」的 11 条、含「视频」的 6 条、含「生日」的 6 条——任何提到「视频」的话都会把那一簇一起拉出来。

### 7.2 三档，按顺序做

| 档 | 做法 | 成本 | 何时 |
|---|---|---|---|
| **L0 现在** | 停用词表（中文高频二元组）+ 长度归一 `score/√len` + 门槛（≥2 个不同 token 命中，或覆盖率 ≥1/3）+ 最多 2 条 | 30 行，零依赖 | 立刻 |
| **L1** | 倒排索引 + BM25（k1=1.2, b=0.75），token = 二元组 ∪ 英文词；开库时从 episode + claim 建一次，append 时增量加 | ~150 行纯 JS，内存几十 KB/千条 | 与模块抽取同批 |
| **L2** | embedding + RRF 混合 | 每条写入 1 次向量调用 + 一个 sidecar 文件 | **先有评测集再说** |

### 7.3 评测集（决定 L2 要不要做的唯一依据）

- 30–50 条人工标注：`用户这句话 → 她应该想起哪几条（claim id / episode id）`。
- 指标：recall@3、MRR、**误注入率**（P@1 里不相关比例）。
- 放行门槛：L1 的 recall@3 < 0.7 **且** 误注入率已可接受，才值得上 L2。
- 顺带：`recall-miss` 遥测——每次用户消息都记「top1 分数」，没有命中的也记。**不记录就永远调不出来。**

成本提醒：L2 的真正代价不是钱，是**热路径多一个网络依赖**（每条用户消息一次 embedding）。折中：写入侧批量 embedding（巩固时那 8 条一起算），查询侧仍然要 1 次。这条折中只在「巩固批次大、查询少」成立，要先测。

### 7.4 两种检索，两种预算（现在混在一起了）

| 模式 | 触发 | 预算 | 语气 | 能否翻折叠 |
|---|---|---|---|---|
| **联想** | 用户每句话（静默） | ≤ 1 行 / 120 字，最多 2 条 | 「他这句话让你想起：…」 | 否（要的是「此刻想起」，不是「查资料」） |
| **查阅** | 她主动想查，或显式被问「你还记得…」 | 3–5 条 + 原文引用 | 正常叙述 | **是** |

「查阅」现在是缺的——这是 HANDOFF 里「折叠后只能记不清 N 件」的正解：**给她一个 `memory_search` 工具**（模块出 `search()`，宿主注册工具）。它让 A4（遗忘是功能）不再是「她真的没了」，而是「想不起来，但能去翻」。这条很便宜，但会改变她的行为质感，值得单独做一次 A/B。

---

## 8. LLM 边界

### 8.1 端口

```ts
interface LLM {
  complete(req: {
    kind: 'consolidate' | 'self' | 'diary' | 'note' | 'request' | 'commitment' | 'identity' | 'activity'
    system: string; user: string
    json?: boolean; maxTokens?: number
    signal?: AbortSignal
  }): Promise<string>
}
```

`kind` 不是装饰：它决定**优先级、预算、超时、以及失败后要不要重试**。现在 `callLLM` 只有一个 45 秒超时（`llm.js:19`）和一种重试策略（没有）。

### 8.2 队列与预算

一轮里现在最多能并发 6 个模型调用（日记/纸条/请求/承诺/违诺/活动）＋巩固 ＋自我。它们**互相抢限流，而且抢输的那个静默消失**。改成：

- **单飞（single-flight）**：同一只鱼、同一 `kind`，同时只有一个在跑。
- **优先级**（预算紧时从下往上砍）：
  1. `consolidate`（唯一的「长期记忆入口」）
  2. `commitment` / `identity`（便宜、事件驱动、错过就永久错过）
  3. `self`（慢但重要）
  4. `diary` / `note`（一天一次，天然低峰）
  5. `request`（已经有正则预筛，保留）
  6. `activity`（最可丢）
- **每日预算**：`{ calls: N, tokens: T }`，记成事件（`llm-call`）而不是内存计数——这样「每天醒几次、每次想多久」（§11.4）是可查的，也能防止插件悄悄烧配额。
- **并发上限**：全局 2–3，换掉现在「一次开 6 个」。

### 8.3 失败、重试、幂等

```
run(task):
  attempt = task.attempts + 1
  try:
     raw = llm.complete(...)             // 解析与门槛在这一步之后，全是纯函数
     parsed = parse(raw)                 // 坏 JSON → 空数组，不抛
     append({t:'consolidation', ok:true, batch, produced, by:{model, promptVersion}})
  catch e:
     append({t:'consolidation', ok:false, batch, error: classify(e), attempts: attempt})
     // due() 下次会看到这条，按 5min/30min/2h 退避重试，3 次后放弃并标记 abandoned
```

三个性质：**不丢批**（失败有记录）、**不重写**（幂等靠 `batch` 相同）、**可回溯**（哪批、哪个模型、哪个提示词版本）。

### 8.4 出处（provenance）——现在完全没有

每条 LLM 产出的认知都带 `by: { model, prompt: 'consolidate@3', schema: 1 }`。这不是洁癖：

- 换脑（§11.2）时要知道哪些认知是旧模型写的，可选择重跑；
- 提示词改版后可以只重跑某几版产出的；
- 出问题时能回答「这条假事实是谁编的」。

### 8.5 认知修正：现在做不到「我错了」

`types.ts` 里三种认知都有 `status: 'active' | 'retired'`，但**全代码没有任何地方写过 `retired`**。于是记忆是单调增长的。实盘里已经出现了后果：21 条事实里至少 4 条是「她给自己取名…」「她能力不足时会诚实承认…」这类自我观察，还有一条自我批评（「甚至为了装 ffmpeg 而偏离话题」）以 0.7 的置信度躺在事实层——它们会一直参与排序，并被当成「记得的事」讲出来。

建议（P1，但要有）：

| 事件 | 语义 |
|---|---|
| `revise { ref, confidence?, note? }` | 降置信 / 记反例 |
| `retire { ref, reason }` | 退休（仍可 `search` 到，但不再注入——和折叠一个路子） |
| `contradict { ref, by: claimId }` | 两条认知冲突；第二次冲突时自动 retire 旧的那条 |

边界：**事实可以退休，价值观不行**（A2）。`semantic` / `procedure` 可 retire；`self` 只能降置信 + 备注；宪章相关根本不进这个流程。

### 8.6 主语：`claim.subject`（P0，比退休更急）

事实层现在不区分「关于他的」和「关于我的」。巩固提示词明确允许 claim 写「他 / 我 / 我们之间」（`consolidation.ts:27-29`），于是 4 条自我观察混进事实层、被当作「记得的事」讲出来，还绕过了自我认知层的慢速与证据门槛（§2）。

加一个枚举字段 `subject: 'user' | 'self' | 'between'`，解析时由提示词要求标注（枚举，不是自由文本），然后按主语路由：

| subject | 落到哪层 | 门槛 |
|---|---|---|
| `user` | 事实层（`semantic`） | 2 条独立证据 |
| `between` | 关系层 | 3 条，且跨会话或跨天 |
| `self` | 自我认知层（`self`） | 2 条，且受 0.1× 速率与 120 轮间隔约束 |

关系层暂时仍以 `semantic` + `layer:'relation'` 表达，不新增事件类型——迁移面越小越好。层不是靠事件类型区分的，是靠 `subject` + `layer` 两个字段（现在的 `isRelationClaim` 靠正则猜，`growth.ts:45`，那是权宜）。

一次 prompt 改动 + 一个枚举字段，就把 STATE.md 待办里的「记忆分『他说 / 我的认知』」落地了，不需要重写巩固流程。

---

## 9. 注入

### 9.1 从固定 3/2/2 改成预算 + 优先级

现在是「3 条事实、2 条教训、2 条自我」写死在 `memorySummary`。改成：

- 预算单位：**字符**（默认 900；宿主可按自己的分词器换算成 token）。
- 组装顺序（前者先占预算）：

| 序 | 块 | 上限 | 可丢 | 理由 |
|---|---|---|---|---|
| 1 | 名字 / 身份 | 1 行 | 否 | 她得知道自己是谁 |
| 2 | 未完成承诺（含 broken） | 2 条 | 否 | 违诺不消失 |
| 3 | 自我认知 | 2 条 | 否（有则必出） | 被问人格时只许引这个 |
| 4 | 情绪 + 6 旋钮 | 2 行 | 否 | A3 的唯一载体 |
| 5 | 事实 | 预算内 | 是 | |
| 6 | 教训 | 预算内 | 是 | |
| 7 | 活动 / 请求 / 答复 | 各 1 | 是 | |
| 8 | 折叠提示 | 1 行 | 是 | 「记不清 N 件」 |

### 9.2 同主题只出一条

实测 37 条里 11 条含「工具」、6 条含「视频」——固定 3 个坑会被 3 条同义改写占满。加一条**多样性约束**：按 token 集合相似度聚类，同一簇最多 1 条（相似度阈值 0.35，就是 §2 里量出来的那档）。

### 9.3 什么留在宿主

| 留宿主 | 理由 |
|---|---|
| 何时调用 `inject()` | 宿主动词；有的宿主没有 inject 只有 wake |
| 指纹比较 + 去重投递 | 已经是宿主行为（10 分钟不重复、跨会话同步） |
| 声音规则 / 关系语域 | 那是「怎么说」，不是「记得什么」 |
| 工具约束 | 情绪→工具的映射是宿主能力 |

渲染文本默认由模块给（`render.text`），宿主可覆盖模板——但**结构的排序与预算必须由模块定**，否则换宿主就会漂。

---

## 10. 不变量 → 测试（一一对应）

| # | 不变量 | 怎么钉住 |
|---|---|---|
| 1 | 只追加 | 每次 append 前后对旧字节做 sha256 前缀校验：前缀必须不变 |
| 2 | 投影可重算 | 删 `projection.json`/`snapshot.json` → `fold` 逐位相同（1e-12）；连删两次仍相同 |
| 3 | 折叠 ≠ 删除 | 构造超窗口的 claim：不注入，但 `search()` 能返回，且原始 episode 仍在 |
| 4 | 证据必须可解析 | 每条 claim 的 `evidence ⊆ 已存在 episode id`，且 `ts(episode) ≤ ts(claim)` |
| 5 | 证据必须独立 | 解析器拒绝「全部指向同一 episode」的 self / 关系类断言（护栏 3） |
| 6 | 跨会话同源 | 两条会话 → 同一鱼 → 快照除运行态外完全相同 |
| 7 | 确定性 | 同一日志 + 固定时钟 + 固定 fake LLM 输出 → 两次运行的日志字节相同 |
| 8 | 不重复落盘 | 同义改写 → `reinforce` + 重量上升，claim 计数不变 |
| 9 | 失败不丢批 | LLM 抛错 → `ok:false` → 下一轮 `due()` 仍返回同一 batch |
| 10 | 单写者 | 第二个实例打开同目录 → 明确报错，不静默写 |
| 11 | 情绪必须能改变行为 | 已有 `src/test.ts` 的「旋钮差 > 阈值」断言保留 |

第 1、7、9 条是现在**一条测试都没有**的——它们是「可回放」的地基，抽模块时先补。

---

## 11. 迁移计划

原则：**先把接口搬过去且行为完全不变，再改语义。** 否则出了偏差分不清是搬家搬坏了还是新策略有问题。

| 步 | 内容 | 验收 | 可回滚 |
|---|---|---|---|
| **0. 打底** | 加 `seq`、`by`、`consolidation` 事件；`log.v2.ndjson` 旁路生成 + 校验后切换；旧 claim 标 `by:'legacy'`、`evidence: []` | 两条真鱼：新旧 `fold()` 差 < 1e-12；认知条数、文本、置信度全等 | 删 v2 文件，回 v1 |
| **1. 抽包** | `packages/memory` 成立；`Creature` 变成薄壳（或直接删）；`collector` 改调 `observe/tick/snapshot` | **golden test**：录 200 轮（用 fake LLM 的固定输出），新旧实现产出逐字节相同的注入文本 | 保留旧 `Creature` 一个 tag |
| **2. 修 P0 语义** | 证据→id、独立性计数、主语路由（§8.6）、触发持久化、同义去重→强化、预算注入、多样性 | §10 的 1–9 全绿；真机跑一周看注入质量 | 事件是新增的，旧字段不动，可回退代码 |
| **3. P1** | BM25、`search()` + 工具、写锁、snapshot、`revise/retire` | 评测集指标 + 折叠可查 | 各自独立，可单点回退 |
| **4. 可选服务化** | 壳 + HTTP + 同一套接口 | 同 §3.2 的触发条件 | 库模式仍在 |

### 关于旧证据的诚实说明

旧的 `evidence` 是**提示词里的行号**，而当时喂进去的是「最近 8 轮」——现在无从知道是哪 8 轮。所以：

- **不要伪造映射。** 迁移时标 `by:'legacy'`、`evidence: []`、`evidenceState: 'unresolvable'`。
- 可选：把现有 37 条认知作为「已知结论」喂回一次巩固，让模型在新的 episode 上重新找证据。这是**新增一条**认知的手段，不是改写历史。

### 四条不变量随目录走

`schemaVersion: 2`、`model.pinned`、`timezone`、`temperament` 都不动。迁移只加字段，不删字段——这样旧版本代码仍能读（只是看不到新字段），回滚安全。

---

## 12. 测试计划

四层，全部零依赖、`node xxx.ts` 直跑，沿用仓库现有的 `check(name, cond)` 风格。

| 层 | 内容 | 需要什么 |
|---|---|---|
| **纯函数单测** | token 化、BM25、证据门槛、去重、权重与折叠、预算与多样性、解析器对坏 JSON 的容忍 | 无 |
| **确定性回放** | `FakeLLM`（按 kind 返回脚本化输出）+ `FakeClock` + 200 轮脚本 → 对账本做 golden hash | 一份场景脚本 + 一份期望账本 |
| **不变量测试** | §10 的 11 条 | 临时目录 |
| **评测集** | 30–50 条 `query → 期望命中`；recall@3 / MRR / 误注入率 | 人工标注一次 |

补充两个现在就该有的：

- **迁移对账**：拿 `~/.fishbowl/creatures/` 的两只鱼做 fixture（脱敏后），旧实现 vs 新实现跑同一份日志，比 `fold`、比认知集合、比注入文本。
- **并发**：两个实例开同一目录（必须报错）；两个会话同一条鱼连打 10 轮（只能产生 1 次巩固，且批次不重叠）。

---

## 13. 需要你拍板的 7 个问题

1. **情绪投影跟不跟着搬？**（§4.3，推荐跟着搬，否则账本要开两个读口）
2. **旧证据不可还原**——接受「legacy 无证据」，还是要拿现有日志重跑一次巩固把证据补上？
3. **关系类断言要求「跨会话或跨天」的证据**，这会让她认关系认得明显更慢（可能几十轮才出一条）。接受吗？（我认为该接受：一次深夜聊天不该定义关系）
4. **检索先做评测集还是先上 embedding？**（推荐评测集；否则你不知道钱花得值不值）
5. **注入预算默认多少字？**（我建议 900 字起；你现在这份摘要大约 500–700 字）
6. **给不给她 `memory_search` 工具？**（这是「折叠后还能翻回去」的唯一实现；也是行为上的一次改变）
7. **认知能不能被推翻？** 事实可以退休、价值观不行（A2）——这条边界要不要写进 DESIGN 的决策记录？

---

## 附：HANDOFF 十问 → 本章节

| # | HANDOFF 的问题 | 回答在哪 |
|---|---|---|
| 1 | 模块边界：库 / 服务 / 库+服务 | §3（结论：库+端口）、§4（四层与目录） |
| 2 | 最小 API、同步/异步、缓存、多实例 | §5（签名 + 语义约定 + 调用序列） |
| 3 | 存储：ndjson 还是 SQLite | §6（保留 ndjson；SQLite 的放行条件与表结构） |
| 4 | 检索：字面 → embedding 何时值得 | §7（L0/L1/L2 + 评测门槛 + 两种检索模式） |
| 5 | LLM 依赖可插拔、失败退避 | §8.1–8.3 |
| 6 | 注入：3/2/2 是否改预算制、跨会话原文边界 | §9、§7.4 |
| 7 | 是否要一层 `MemoryHost`（storage + llm） | §3.2 的四条约束、§4.1 的 ports |
| 8 | 必须守住的不变量 | §10（11 条，逐条对应测试） |
| 9 | 迁移与 schema 版本 | §11 |
| 10 | 测试：纯函数单测 + 无 LLM 的确定性回放 | §12 |
