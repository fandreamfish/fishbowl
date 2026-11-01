# fishbowl 学习文档

> 版本：0.14.7 · 行号以当前工作区为准（文件改动后请重新对照）
> 读者：想从零读懂这个项目的人；不需要先读别的文档。
> 读法：先看第 1–3 节建立地图，再按第 4–11 节逐包读，最后看第 12–13 节把时序串起来。

---

## 1. 项目是什么

**一句话**：一条住在 DSH（DeepSeek Harness）里的鱼，靠"经历"长成人格，情绪会真实改变她的行为。

三条设计公理（违反任何一条都说明改错了方向）：

1. **人格不是配置出来的**：`meta.json` 里的 `temperament` 只是初始倾向；人格是账本里事件的轨迹。
2. **情绪必须改变行为**：情绪 → 6 个偏置旋钮 → 工具策略/说话长短/是否验证。只记录不影响的情绪等于没有。
3. **遗忘是功能**：负面情绪按半衰期衰减，记忆会退休；不是 bug。

四个"不变量"：

- 一个体 = 一个目录 + 一个常驻进程
- 一条鱼 = 一个会话（房间），终身唯一
- 时区显式配置，不用系统时区
- 模型随个体绑定（`meta.model`）

---

## 2. 目录与分层

```
packages/
  affect/        情绪与偏置的纯数学（无 IO）
  memory/        记忆：账本投影、总结、合并、召回、渲染
  being/         个体：Creature facade、住处、许可、日记、家目录
  schedule/      清醒调度：醒来窗口、联系闸门、自处配额
  journal/       日记/小纸条/请求的提示词与解析
  voice/         语气规则（按关系原型）
  bilibili/      B 站：只读浏览、评论、风控、登录
  app/           应用层：配置、绑定、回合收集、唤醒循环、约束
  adapter-dsh/   DSH 适配器：宿主能力、HTTP 路由、视图
  plugin/        DSH 插件：组合根、工具、设置页前端
  bridge-qq/     QQ 桥（独立进程，同一份账本）
```

依赖方向由 `scripts/dev/check-layers.mjs` 强制（0–4 分层，从外往内）：

```
affect(0) → memory/being/schedule/journal/voice/bilibili(1)
          → app(2) → adapter-dsh/plugin/bridge-qq(3) → scripts(4)
```

跨包只能 import 对方的 `packages/<pkg>/src/index.*`，由 `check-interfaces.mjs` 强制。改代码前先知道这两条，否则检查会挂。

---

## 3. 数据模型：一个体就是一本账

### 3.1 磁盘布局

数据根 `~/.fishbowl`（由 `app/config.js:14` 的 `dataRoot` 决定）：

```
~/.fishbowl/
  creatures/<uuid>/        ← 每条鱼一个目录（cfg.stateDir，config.js:15）
    meta.json              ← 身份：名字、出生、时区、模型、temperament、occupancy
    log.ndjson             ← 唯一真相：append-only 事件流
    projection.json        ← 情绪投影缓存（可删，重算一致）
    outbox.json            ← 待投递消息
    config.json            ← 这条鱼的全部设置（第 13 节）
    home/                  ← 她可以随便改的文件夹
      diary/               ← 一天一个 .md
      notes/               ← 一条一个 .md
  home/大肥鱼的屋子/       ← 工作区（房间的父目录）
  config.json              ← 插件级配置快照（不含 apiKey）
  scopes.json              ← 工作区/会话索引
  ui-config.json           ← 旧设置页全局配置（历史兼容）
  wake-state.json          ← 唤醒循环状态
  trace.ndjson             ← 运行诊断
```

`Creature` 在打开时会确保 `home/` 存在并把旧位置的 `diary/`、`notes/` 搬进去（`being/src/home.ts:23` 的 `ensureHome`）。

### 3.2 事件

每个事件是一行 JSON，信封固定（`affect/src/types.ts:97` 起）：

```json
{ "t": "turn", "id": "uuid", "ts": 1793520000000, ... }
```

事件类型全表在 `affect/src/types.ts:97-139`，按用途分：

| 行 | 类型 | 用途 |
|---|---|---|
| 98 | `episode` | 旧版轮次（正在被 turn 取代） |
| 100 | `turn` | 一轮对话 + 记忆原料 |
| 105 | `absence` | 缺席（清醒小时数） |
| 106 | `contact` | 重逢释放想念 |
| 107 | `repair` | 被原谅，降愧疚 |
| 109/110 | `semantic`/`procedure` | 旧记忆条目 |
| 112 | `identity` | 接受名字 |
| 114 | `self` | 自我认知 |
| 116/117 | `commitment`/`commitment-resolved` | 承诺与兑现/违诺 |
| 119 | `activity` | 一起做的事 |
| 121 | `reinforce` | 记忆强化 |
| 123 | `outreach` | 主动联系配额 |
| 125 | `wake` | 醒来（contact/self） |
| 127 | `grant` | 长期允许 |
| 129/130 | `diary`/`note` | 日记 / 小纸条 |
| 131 | `request` | 请求 |
| 132/133 | `permit`/`permit-used` | 一次性许可与消费 |
| 134 | `breach` | 没等同意就做了（审计） |
| 135 | `request-answered` | 请求被回答 |
| 137/138 | `freeze`/`unfreeze` | 封存 |

**事件契约**在 `docs/EVENTS.md`：只加字段不改语义；改语义 = 新类型 + 追加式迁移；不删旧行。

### 3.3 Store（读写账本）

`being/src/store.ts:17` 的 `Store` 是所有磁盘读写的唯一入口：

- `readMeta`/`writeMeta`（36/48）
- `appendEvent`（52）：一行一个 JSON，追加写
- `readEvents`（56）：坏行跳过，不毒死整本账
- `readCache`/`writeCache`（61/69）：情绪投影缓存
- `readOutbox`/`appendOutbox`（81/94）：消息投递

### 3.4 情绪投影

`Creature.fold()`（`being/src/creature.ts:79`）重放事件得到当前情绪；
`affectNow()`（118）在 fold 基础上按时间衰减；`bias()`（129）把情绪压成 6 个旋钮。

情绪本身不用事件慢慢攒：`longingAt()`（65）用"距上次互动多久"直接算。

---

## 4. 情绪与偏置（affect）

文件：`packages/affect/src/engine.ts`

| 行 | 函数 | 作用 |
|---|---|---|
| 8 | `salienceOf` | 这件事值不值得记住 |
| 19 | `applyAppraisal` | 一次评价 → 情绪增量 |
| 83 | `applyElapse` | 时间流逝：向基线回落 |
| 103 | `applyAbsence` | 缺席 → 想念 |
| 109 | `applyContact` | 重逢 → 想念释放 |
| 114 | `applyRepair` | 修复 → 愧疚下降 |
| 128 | `toBias` | 情绪 → 6 旋钮 |

- `HALF_LIFE_DAYS`（73）：愧疚 3 天、想念 2 天、负面 2 天，可按鱼覆盖（`affect` section）
- `Bias`（`types.ts:75`）：`verbosity/thresholdRefuse/thresholdVerify/riskAppetite/disclosure/patience`，基线 0.5（84）
- `Temperament`（`types.ts:3`）：`reactivity/baselineArousal/baselineValence/decayRate/salienceThreshold`
- 成长曲线：`growth.ts` 的 `layerRate`（17）/`memoryWindowDays`（41）决定"学多快、记多久"

偏置怎么用：`app/src/constraints.js:22` 的 `verifyDecision` 决定工具要不要先问；`verbosity` 影响说话长度；`thresholdRefuse` 决定拒绝；`riskAppetite` 决定敢不敢动手。

---

## 5. 个体（being）

### 5.1 Creature facade

`being/src/creature.ts:32` 是唯一对外的个体对象，方法按用途分：

| 行 | 方法 | 作用 |
|---|---|---|
| 54 | `static open` | 打开目录（含 ensureHome） |
| 79/118/129 | `fold`/`affectNow`/`bias` | 情绪投影 |
| 133 | `recordEpisode` | 旧轮次 |
| 140/144/148 | `recordAbsence`/`recordContact`/`recordRepair` | 缺席、重逢、原谅 |
| 183/188 | `recordOutreach`/`outreachTimes` | 主动联系配额 |
| 197/202 | `recordWake`/`selfWakeTimes` | 醒来记账 |
| 212/217 | `recordGrant`/`activeGrants` | 长期允许 |
| 237/242 | `setOccupancy`/`releaseOccupancy` | 住处 |
| 249–265 | 日记 / 小纸条 | 事件 + 文件 |
| 270–295 | 请求 / 回答 / digest | 请求链路 |
| 319 | `openCommitments` | 未完成承诺 |

方法体本身很薄，真正的实现在同包的 facets：

- `journal-facets.ts`：日记/笔记/请求（`writeDiaryFile` 96、`writeNoteFile` 116）
- `permits.ts`：许可（`recordPermit` 49、`findPermit` 66、`consumePermit` 74、`permitLine` 79、`recordBreach` 92）
- `policy.ts`：工具唯一该问的许可判断（`checkPermission` 17、`usePermit` 31）
- `signals.ts`：对话取材、唤醒、许可（`recentDialog` 24、`recordWake` 36、`activeGrants` 64）
- `tenancy.ts`：住处冲突（`findConflict` 33、`resolveOccupant` 50）
- `commitment.ts` / `activity.ts`：从对话里识别承诺/活动

### 5.2 家目录与写保护

`home.ts` 定义她的可写目录（10/14/18）。她只能改 `home/`，别的地方只读——由 `constraints.js` 的守卫在工具层执行（第 7.5 节）。

注意：这是**工具层**限制，不是 OS 沙箱；她能读所有文件（包括 `bili-auth.json`），这是有意的取舍。

---

## 6. 记忆（memory）

### 6.1 账本与视图

- `ledger.ts:10` 的 `Ledger` 与 `being` 的 Store 共用同一本 `log.ndjson`；`read`（21）按字节缓存，`append`（57）追加
- `records.ts:67` 的 `buildView(events)` 把事件流投影成 `{turns, memories, watermark, attempts}`；这是所有记忆功能的只读视图
- `weightOf`（207）：记忆权重随时间和强化变化

### 6.2 Memory 类

`memory.ts:51` 的 `Memory` 是一切的编排者：

| 行 | 方法 | 作用 |
|---|---|---|
| 104 | `view()` | 带快照缓存的投影（按 byteSize 失效） |
| 153 | `observe(turn)` | 零 LLM，落一条 turn（关闭记忆时直接 return） |
| 205 | `tick({llm,...})` | 双总结 + 合并；有预算、失败退避 |
| 326 | `merge()` | 把一批 turn 合并成一条记忆 |
| 435 | `search()` | 关键词/向量检索 |
| 498 | `render()` | 预算制注入块（情绪 + 记忆 + 承诺） |

`tick` 的顺序（205–312）很重要：

1. 关闭记忆 → 直接返回
2. **先合并**（一次调用，记忆先长出来）
3. 再补每轮总结（中性 + 她的），最多 `maxCalls`
4. 返回 `{her, neutral, merged, rejected, errors, skipped}`

合并阈值：积压 ≥ `consolidateCap` 或积压 ≥ 3 且最老一轮超过 10 分钟（idle flush）。

### 6.3 总结与合并的提示词

- `summarize.ts`：`HER_SYSTEM`（6）/`NEUTRAL_SYSTEM`（19）、`parseHer`（63）、`parseNeutral`（71）、`splitSegments`（108）
- `consolidate.ts`：`MERGE_SYSTEM`（8）、`parseMerge`（38）、`gateMemories`（68）做证据门槛/去重
- 防幻觉：`locateQuote`（`summarize.ts:89`）必须在原文里逐字找到引用，否则降级

### 6.4 渲染

`render.ts`：

- `renderStateBlock`（62）：纯状态骨架（QQ 渠道用）
- `renderText`（108）：预算制注入文本（情绪行 + 记忆行）
- `pickMemories`（96）：按权重/相关度选
- `fingerprint`（166）：内容没变就不重复注入

DSH 与 QQ 的最终状态由 `app/src/state.js:22` 的 `composeState` 统一拼装，避免两个渠道各写一份。

### 6.5 单写者锁

`lock.ts:46` 的 `acquireWriterLock` + 心跳；`readWriterLock`（98）给设置页显示"另一个进程正在写"。同一只鱼只该有一个进程写账本。

---

## 7. 应用层（app）

### 7.1 配置

`config.js:11` 的 `normalizeConfig` 是入口，关键键：

- `dataRoot`（14）/`stateDir`（15）/`homeRoot`（21）
- `appraiser`（28）：评价器（scripted/deepseek）
- `memory`（63）、`capabilities`（76）、`browse`（94）、`comment`（97）

`configHealth`（106）在启动时检查 appraiser 是否退化、key 是否为空、清醒是否全关。

### 7.2 单鱼配置（最重要）

`fishcfg.js`：

| 行 | 函数 | 作用 |
|---|---|---|
| 18 | `fishConfigPath` | `creatures/<id>/config.json` |
| 44 | `pickFishPatch` | 白名单校验，别名/类型钳制 |
| 106 | `writeFishConfig` | 以完整模板打底 + 旧文件 + patch，一层深合并；写完清缓存 |
| 124 | `configFor` | 默认值 + 这条鱼的覆盖 |
| 151 | `fishConfigView` | 设置页看到的形状 |
| 218 | `fullFishConfig` | 12 个顶层键的完整模板 |
| 237 | `ensureFullFishConfig` | 启动时补齐缺键（已有的优先） |

**规则**：一条鱼出生时写一份完整模板；之后所有读写都以这份文件为准。全局默认只在"文件缺键"时兜底。

### 7.3 绑定与会话

`binding.js:20` 的 `createBinding`：

- `listCreatures` 扫 `stateDir` 下的目录
- `occupantOf/resolve` 会话 → 鱼（按 `meta.occupancy`）
- `assign` 改住处（冲突检查）
- `birth` 出生（创建目录 + 写完整 config + 随机 temperament）

住处模型：**一条鱼 = 一个会话（房间），终身唯一**；换房 = 归档旧会话 + 新建会话。

### 7.4 回合收集

`turn.js:45` 的 `createCollector` 是 DSH 事件与"一轮"之间的桥：

| 行 | 函数 | 作用 |
|---|---|---|
| 69 | `pushItem` | 把 user/assistant/tool 文本塞进本轮 buffer |
| 85 | `tickMemory` | 同一只鱼同时只跑一个 tick（去重） |
| 141 | `finishTurn` | 一轮结束：评价 → 情绪 → 承诺 → 日记 → 记忆 |
| 226 | `buildStateText` | 组装状态块（同一轮内缓存） |
| 250 | `onSessionEvent` | 订阅 DSH 事件 |
| 285 | `setupAgent` | 注册 voice 段 + 动态状态段 |
| 352 | `flushTimer` | 每 10 分钟整理所有鱼 |

一轮的完整顺序：

```
turn/start
  → user/message / assistant/message / tool/result 进 buffer
turn/end
  → finishTurn:
     转写 → appraise（评价）
     recordEpisode/observe
     detectCommitment / checkBroken / detectActivity / detectIdentity
     maybeGrant（从用户话里识别许可）
     runDiary（到点写日记）
     tickMemory（双总结 + 合并）
```

注意：状态块现在是 **agent 的动态系统提示段**（`host.stateSection`，host.js:154），不再往 inbox 塞消息——否则会被当成"用户说的话"，造成自问自答。

### 7.5 约束

`constraints.js`：

- `verifyDecision`（22）：偏置 → 要不要先问
- `guard`（87 起）：同步拒绝（写保护、系统级破坏命令、预算）
- `preExecute`（165）：危险工具返回 ask
- `budgetVerdict`（65）：一轮工具次数上限

### 7.6 唤醒与主动联系

`wake.js:29` 的 `createWakeLoop` 每 tick（57）：

1. 每条鱼用自己的 `wake.activeWindow` 判断时段（第 82–84 行）
2. `wakeReason`（`wake/plan.js:11`）判断有没有由头（违诺、想念）
3. `ContactGate` 控制主动联系配额；`selfGateFor` 控制自处配额
4. 触发 `host.wake`，把"醒一醒"作为 situation 注入

`wake/plan.js` 还有 `wakeStatePath`（50）把报告写到数据根。

### 7.7 注入与状态

- `injector.js`：`recentBlock`（15）、`recallBlock`（31）、`summaryText`（44）、`injectMessage`（62）、`moveInText`（95）
- `state.js:22` 的 `composeState`：DSH 渠道加许可/请求/违约/最近对话；QQ 渠道只放状态

---

## 8. B 站能力（bilibili）

### 8.1 只读浏览

- `runtime.js:38` 的 `lookForCreature`：看一次（窗口、风控、配额、pacing）
- `browseStatus`（101）：状态条数据
- `browse.ts`：配置规范化（`normalizeBrowseConfig` 48）、时间窗（83）、计划（280）、素材渲染（264）
- `browse.js`：实际抓取（`lookOnce` 143）、记录（`recordBrowse` 213）
- `client.js:186` 的 `createClient`：HTTP、签名（89）、风控识别（64）
- `risk.js`：风控冷却（`noteRisk` 47、`riskState` 76）

### 8.2 评论

- `comment.js:197` `postComment` / 241 `postReply`
- `scanReplies`（135）/`scanDueReplies`（165）：查有没有人回
- `guard.js:111` `screenOutgoing`：出门前的秘密/隐私闸（`looksLikeLeak` 66、`looksLikeSecret` 60）
- `config.js`：`normalizeComment`（4）/`pickCommentConfig`（23）

### 8.3 登录

- `auth.js:17` `authPath` → `~/.fishbowl/bili-auth.json`
- `saveAuth`（105）/`clearCookie`（140）/`parseCookieInput`（56）
- 账号 uid/昵称属于这个文件，**不属于** `creatures/<id>/config.json`

---

## 9. DSH 适配器（adapter-dsh）

### 9.1 宿主能力

`host.js:32` 的 `createDshHost` 把 DSH 服务包成规则简单的接口：

| 行 | 方法 | 作用 |
|---|---|---|
| 70/74/78 | onSessionEvent / onAgentCreated / onAgentDisposed | 事件订阅 |
| 82/87 | agentFor / listAgents | 会话 ↔ agent |
| 103 | registerRoute | 路由注册（等服务就绪） |
| 144/148 | inject / wake | 注入 / 主动开一轮 |
| 154/166 | stateSection / voice | 动态状态段 / 语气段 |
| 170/175/184 | guard / registerTool / preExecute | 工具拦截 |
| 207 | nameScope | 改会话标题 |
| 229/241 | createWorkspace / createSession | 房间 |
| 335/350/355/375 | workspaceByPath / detach / archive / unarchive | 归档与恢复 |
| 384/400 | sessionDirsOf / deleteSessionFiles | 磁盘操作 |
| 408 | listScopes | 工作区/会话枚举 |
| 469 | services | 诊断（含 `version`） |

`host/scopes.js` 是拆出去的纯函数：`workspaceOf`（9）、`findAgent`（15）、`decodeWorkspace`（44）、`enumerateScopes`（75）。

### 9.2 HTTP

`http.js:22` `createUiRoute` 注册一个 prefix 路由 `/fishbowl-ui`；分发顺序在 54–60：

```
handleFish → handleBrowse → handleConfig → handleFs
→ handleCleanup → handleTransfer → handleRequests
```

**教训**：`handleRequests` 必须检查 `parts[0] === 'requests'`（`resources/requests.js:5`）。它曾经只判断 GET，把所有未匹配 GET 都返回成 `{requests:[]}`，导致 `GET /fish/:id` 永远读不到配置。

### 9.3 路由表（fish.js）

| 行 | 路由 | 数据 |
|---|---|---|
| 18 | `GET /fish` | 列表（stateView） |
| 19 | `POST /fish` | 新建（birth + 搬入 + 唤醒） |
| 51 | `GET /fish/:id` | **单鱼详情（设置页回填）** |
| 63 | `GET/POST /fish/:id/config` | 单鱼配置读写 |
| 82 | `POST /fish/:id/move` | 换房（归档旧 + 新建） |
| 119 | `POST /fish/:id/name` | 改名（写 meta） |
| 128 | `POST /fish/:id/room/restore` | 取消归档并切回旧房 |
| 143 | `POST /fish/:id/delete` | 放生 |
| 159 | `GET /fish/:id/memory` | 记忆详情（用 configFor） |
| 161/165/178 | browse 状态/历史/手动刷 | 全部用 configFor |
| 193/197 | bili 状态/扫描 | 全部用 configFor |
| 202/203 | requests 列表/回答 | 回答会签发 permit + 唤醒 |

### 9.4 视图

- `views.js:12` `createViews`；`fishView`（13）把 Creature 映射成设置页结构（`config` 来自 `fishConfigView`）；`stateView`（72）给列表；`summarizeEvent`（89）给时间线
- `views-memory.js:157` `memoryDetail` 现在用 `configFor(cfg, creature)`，不再用全局 memory 配置

---

## 10. 插件（plugin）

### 10.1 组合根

`index.js:37` 的 `apply` 是唯一装配处，顺序：

```
读本地 config 快照 → normalize → 健康检查
→ createDshHost → createBinding（补齐每条鱼 config）
→ constraints（81）
→ 注册工具（106–109：browse / speak / permission / memory）
→ collector（114）
→ wake loop（122）
→ UI 路由（132）
```

工具注册条件：`anyFishHas('browse')`；memory_search 受 `memory.searchTool` 控制。

### 10.2 四个工具

| 文件 | 行 | 工具 | 关键逻辑 |
|---|---|---|---|
| `lib/browse/tool.js` | 21 / 56 | `fish_bili_look` | 68–72：`checkPermission` + `usePermit`；75：说过"要申请"就记 breach |
| `lib/browse/speak-tool.js` | 18 / 56 | `fish_bili_speak` | 69–76：许可检查；出门前过 guard |
| `lib/browse/permission-tool.js` | 30 / 53 | `fish_ask_permission` | 74–75：requirePermit 关着直接回"不用问"；85：建请求 |
| `memory/tool.js` | 46 / 63 | `memory_search` | 71：`memory.enabled` 关掉就拒绝 |

### 10.3 设置页前端

`client.js` 是单文件 UI（约 1730 行），结构：

| 行 | 组件/函数 | 作用 |
|---|---|---|
| 18 | `OPTIMISTIC` | 刚改的配置先记内存，防止重载被旧值盖回 |
| 119 | `Toggle` | 开关 |
| 150 | `MemoryConfigCard` | 记忆配置（自动保存） |
| 320 | `MemoryDetail` | 记忆详情 |
| 495 | `BrowsePanel` | 上网/说话/登录 |
| 538 | `saveCfgNow` | 上网配置立即保存 |
| 562 | `loadAll` | 读 `/fish/:id`（失败报错，不回退全局） |
| 602 | `commit` | 改配置 + 写乐观覆盖 + 发 POST |
| 993 | `personaSaveNow` | 成长率/来历保存 |
| 1025 | `saveRoutine` | 作息立即保存 |
| 1245 | `renderStatus` | 状态/能力 |
| 1279 | `renderRoutine` | 作息 |
| 1425 | `renderPersona` | 人设 |
| 1648 | `mountRequestToast` | 右下角请求提醒（轮询 `/requests`） |
| 1711 | `apply` | 注册 settings.section + toast |

自动保存设计：改就写（500ms 防抖），组件卸载时把 pending 补发；`OPTIMISTIC` 让重新打开页面时先显示本地新值，30 秒内有效。

---

## 11. QQ 桥（bridge-qq）

独立进程，同一份账本：

- `lib/pipeline.js:21` `rememberTurn`：把一轮写进账本
- `reply`（43）：建临时 Memory（锁 `warn`）→ `composeState(..., channel:'qq')`（70）→ 调 LLM
- 公开渠道只带状态，不带私事；写操作仍受同一套 guard/许可约束

---

## 12. 端到端时序

### 12.1 一轮对话

```
用户发消息
  → DSH turn/start
       buildStateText（turn.js:226）作为系统提示段注入
  → user/message 进 buffer（turn.js:250）
  → 模型回复（可能调工具）
  → turn/end
       finishTurn（141）
         appraise → 情绪事件
         memory.observe → turn 事件
         承诺/活动/身份识别
         到点写日记
         tickMemory → 总结 + 合并
  → 下一轮状态块反映新情绪/记忆
```

### 12.2 记忆整理

```
tickMemory（turn.js:86，去重）
  → Memory.tick（memory.ts:205）
      合并优先（326）
      然后逐轮补总结（HER/NEUTRAL）
  → 写 summary / merged 事件
  → 设置页记忆详情可见
```

### 12.3 许可

```
她调 fish_ask_permission
  → requirePermit=false：直接回"不用问"
  → true：recordRequest → 右下角卡片
用户点同意
  → 后端 recordPermit（带 uses/ttl）
  → wake 她一次（或写 outbox）
她调 fish_bili_look / speak
  → checkPermission（policy.ts:17）
  → 有许可消费；没有则拒绝/记 breach
```

### 12.4 导入

```
POST /import {path}
  → 确保 ~/.fishbowl 存在
  → 按 id 导入：已存在只补文件
  → 校验住处（旧机器会话不存在则清空）
  → 建/复用「大肥鱼的屋子」
  → 没住处的鱼各建一间房
```

### 12.5 换房 / 恢复

```
POST /fish/:id/move → 归档旧会话 → 新建会话 → 改 occupancy → 搬入提示
POST /fish/:id/room/restore → unarchive 旧会话 → occupancy 切回 → 归档当前
```

---

## 13. 配置系统

### 13.1 层级

```
profile cordis.patch.yml      ← 插件启动配置（DSH 可能重写，不能当唯一真相）
~/.fishbowl/config.json       ← 上次生效的配置快照（不含 apiKey）
~/.fishbowl/creatures/<id>/config.json  ← 每条鱼的真相（12 个顶层键）
```

启动时：`readPluginConfig` 打底 → profile 覆盖 → ui-config 覆盖（旧）→ normalize。

### 13.2 单鱼 config.json 的 12 个键

`growth / seed / wake / contact / selfTime / memory / browse / comment / capabilities / diary / affect / relation`

- 出生时 `ensureFullFishConfig` 写完整模板（fishcfg.js:237）
- 之后所有设置读写都用这个文件
- 写入时以模板打底（106），旧文件缺子键会自愈
- `capabilities.browse` 与 `browse.enabled` 保持一致（configFor，124 起）
- `seed` 出生后只读；API 改 seed 会被丢弃（fish.js:63 起）

### 13.3 设置项 → 文件

详见 `docs/SETTINGS-CONFIG-AUDIT.md`。摘要：

| 设置 | 读 | 写 |
|---|---|---|
| 上网 / 说话 / 作息 / 人设 / 记忆 | `GET /fish/:id` → configFor → config.json | `POST /fish/:id/config` → writeFishConfig |
| 能力开关 | 同上（capabilities） | 同上（并同步 browse.enabled） |
| B 站账号 uid/昵称 | `GET /bili` → bili-auth.json | `POST /bili` → bili-auth.json |
| 插件级（模型/key/时区） | profile | profile（本地快照不含 key） |

**规则**：页面编辑哪条鱼，就必须读这条鱼的 `/fish/:id`；读失败要报错，绝不回退全局值再写单鱼文件。

---

## 14. 测试、检查与发布

- `npm run test:all` = 分层 + 接口 + 模块加载 + 七套测试
- 测试文件：`packages/memory/test/unit.test.ts`、`packages/plugin/test/{unit,browse,bili}.test.ts`、`packages/bridge-qq/test/unit.test.ts`
- 冒烟：`scripts/smoke/m7-apply-smoke.ts`
- 发布流程：改代码 → tests → `docs/releases/<version>.md` → `VERSIONING.md` → commit → tag → push（走代理）

检查脚本本身也在守架构：

- `check-layers.mjs`：依赖方向
- `check-interfaces.mjs`：跨包只能 import 入口
- `check-imports.mjs`：模块能加载
- `dead-exports.mjs`：疑似未使用导出

---

## 15. 踩过的坑（读代码时最容易再犯）

1. **`/requests` 兜住所有 GET**：`handleRequests` 必须检查路径。它曾让 `GET /fish/:id` 返回请求列表，设置页永远读不到配置。
2. **`GET /fish/:id` 不存在**：路由只有 `/fish` 和 `/fish/:id/...`，两段路径 404。
3. **自动保存打到 `/fish/undefined/config`**：`data.fish.id` 是数组上的 undefined，必须用 `view.id`。
4. **回填用全局 config**：`useCallback(..., [])` 闭包初始 view，单鱼分支变死代码。
5. **浅合并丢兄弟键**：只改 `comment.requirePermit` 会覆盖 comment 其它键；必须一层深合并。
6. **两个"开关"打架**：`capabilities.browse` 与 `browse.enabled` 必须同步，否则页面显示有、按钮却是禁用。
7. **出生后 seed 可改**：UI disabled 不是安全边界，后端要检查。
8. **`stateDir` 不是数据根**：它是 `creatures/`；`dataRoot` 才是 `~/.fishbowl`。用 `dirname` 推路径踩过两次。
9. **profile 配置会被 DSH 重写**：fishbowl 段曾整段消失；本地快照是兜底。
10. **旧进程还在写**：改完必须重启 DSH 并看 `/debug/services` 的 `version`；旧进程会继续浅合并写坏 config.json。
11. **状态块不要塞 inbox**：会被当成用户消息，导致自问自答；用动态系统提示段。
12. **记忆 tick 会重复**：轮末、十分钟清扫、打开房间三处触发，必须去重。

---

## 16. 学习路线与练习

### 路线 A：只想理解"她怎么活着"（2 小时）

1. `affect/src/types.ts`（情绪与偏置的定义）
2. `affect/src/engine.ts`（评价 → 情绪 → 旋钮）
3. `being/src/creature.ts` + `store.ts`（账本与投影）
4. `app/src/turn.js` 的 `finishTurn`（一轮怎么落账）
5. `memory/src/memory.ts` 的 `tick`（记忆怎么长出来）
6. `app/src/state.js`（状态怎么回到下一轮）

### 路线 B：想改设置页（半天）

1. `client.js` 的 `BrowsePanel`/`FishDetail`/`MemoryConfigCard`
2. `adapter-dsh/src/resources/fish.js` 路由
3. `app/src/fishcfg.js` 的 `writeFishConfig`/`configFor`/`fullFishConfig`
4. `docs/SETTINGS-CONFIG-AUDIT.md` 对照表
5. 跑 `browse.test.ts` 的 roundtrip 测试

### 路线 C：想接新能力（一天）

1. 在 `being` 定义事件/许可（如需）
2. 在 `bilibili` 或新包实现纯逻辑
3. 在 `app` 加配置和回合钩子
4. 在 `plugin` 注册工具 + 设置页
5. 在 `adapter` 加路由（如需要）
6. 补测试 + release note

### 练习

1. 找到 `turn` 事件被写入的准确位置，并解释为什么它同时服务情绪和记忆。
2. 给"想念半衰期"加一个 UI 控件：列出要改的文件与行。
3. 让"看 B 站"的许可过期后自动出现在设置页；描述数据流。
4. 解释为什么 `GET /fish/:id` 读失败时不能回退全局值。
5. 写一条新事件 `nap`（她打了个盹）：按 `docs/EVENTS.md` 列出必改点。

---

## 附录 A：关键符号索引

> 行号 = 定义所在行；文件均相对 `packages/`。

### affect

- `config.ts`：`normalizeAffect` 4
- `engine.ts`：`salienceOf` 8、`applyAppraisal` 19、`HALF_LIFE_DAYS` 73、`applyElapse` 83、`applyAbsence` 103、`applyContact` 109、`applyRepair` 114、`toBias` 128
- `growth.ts`：`layerRate` 17、`memoryWindowDays` 41
- `types.ts`：`Temperament` 3、`Appraisal` 28、`Affect` 51、`Bias` 75、`CreatureEvent` 97

### being

- `creature.ts`：`Creature` 32、`open` 54、`fold` 79、`affectNow` 118、`bias` 129
- `home.ts`：`homeDir` 10、`ensureHome` 23
- `permits.ts`：`recordPermit` 49、`findPermit` 66、`consumePermit` 74、`permitLine` 79、`recordBreach` 92
- `policy.ts`：`checkPermission` 17、`usePermit` 31
- `journal-facets.ts`：`recordDiary` 16、`writeDiaryFile` 96、`writeNoteFile` 116
- `signals.ts`：`recentDialog` 24、`recordWake` 36、`activeGrants` 64
- `store.ts`：`Store` 17、`appendEvent` 52、`readEvents` 56
- `tenancy.ts`：`findConflict` 33、`resolveOccupant` 50

### memory

- `memory.ts`：`Memory` 51、`view` 104、`observe` 153、`tick` 205、`merge` 326、`search` 435、`render` 498
- `ledger.ts`：`Ledger` 10、`read` 21、`append` 57
- `records.ts`：`buildView` 67
- `render.ts`：`renderStateBlock` 62、`renderText` 108
- `config.ts`：`normalizeMemory` 47、`validateMemory` 73
- `lock.ts`：`acquireWriterLock` 46、`readWriterLock` 98
- `summarize.ts`：`parseHer` 63、`parseNeutral` 71
- `consolidate.ts`：`gateMemories` 68

### app

- `config.js`：`normalizeConfig` 11、`configHealth` 106
- `fishcfg.js`：`pickFishPatch` 44、`writeFishConfig` 106、`configFor` 124、`fullFishConfig` 218、`ensureFullFishConfig` 237
- `binding.js`：`createBinding` 20
- `turn.js`：`createCollector` 45、`finishTurn` 141、`buildStateText` 226、`setupAgent` 285
- `turn/after.js`：`createAfterTurn` 30、`runDiary` 65
- `state.js`：`composeState` 22
- `constraints.js`：`createConstraints` 72、`guard` 87、`preExecute` 165
- `wake.js`：`createWakeLoop` 29、`tick` 57

### adapter-dsh

- `host.js`：`createDshHost` 32；方法表见 9.1
- `host/scopes.js`：`workspaceOf` 9、`enumerateScopes` 75
- `http.js`：`createUiRoute` 22、分发 54–60
- `resources/fish.js`：路由表见 9.3
- `resources/requests.js`：`handleRequests` 2、路径判断 5
- `views.js`：`createViews` 12、`fishView` 13、`stateView` 72
- `views-memory.js`：`memoryDetail` 157

### plugin

- `index.js`：`apply` 37、工具注册 106–109、collector 114、wake 122
- `client.js`：组件/函数表见 10.3
- 工具：`lib/browse/tool.js` 21、`speak-tool.js` 18、`permission-tool.js` 30、`memory/tool.js` 46

---

## 附录 B：继续读什么

- `docs/ARCHITECTURE.md`：分层与边界
- `docs/EVENTS.md`：事件契约
- `docs/SETTINGS-CONFIG-AUDIT.md`：设置项读写对照
- `docs/MEMORY.md`：记忆设计
- `docs/STATE.md`：状态与投影
- `ROADMAP.md`：里程碑与取舍
- `docs/releases/<version>.md`：每次改动的动机
