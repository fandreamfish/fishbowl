# 设置页 · 配置读写一致性审计

审计范围：`packages/plugin/client.js` 设置页全部控件、`packages/adapter-dsh/src/resources/*` 路由、`packages/app/src/fishcfg.js` 读写实现。
方法：**只读源码 + `node -e` 直接读模块/文件**，未依赖 `127.0.0.1` 的 HTTP 响应；数据目录 `C:\Users\24358\.fishbowl\creatures\`（5 条鱼）。
数据快照：2026-11-01 21:33（本地）。审计期间 5 份 `config.json` 被运行中的进程整份重写（mtime `2026-11-01T13:33:52Z`），以下按重写后的最终状态核对。

## 1. 结论

1. **主路径已经做到「读写同一份 config.json」**：设置页所有配置写入都走 `POST /fish/:id/config` → `writeFishConfig` → `creatures/<creatureId>/config.json`；回填走 `GET /fish/:id` → `fishConfigView` → `configFor` → 同一个文件。没有一条设置项的常规保存再写 `ui-config.json`。
2. **上网**：requirePermit / window / perDay / topN / deepRead / danmaku / sources / keywords / avoid.keywords / avoid.minDuration / pacing.* 共 12 个有控件的项，读写同文件 ✅；`browse.enabled` 没有直接控件，只由「状态→能力」写入时同步（`fishcfg.js:69`）。
3. **说话**：enabled / requirePermit / perDay / replyPerDay / replyToReplies / scanEveryMin / window / atOwner 读写同文件 ✅；`autoApprove` 有键有默认、**设置页没有控件** ❌。
4. **作息/人设/记忆**：有控件的项都读写同文件 ✅。但 `wake.idleSkip`、`contact.burst`、`contact.requireReason`、`selfTime.idleWaitMs`、`diary.enabled`、`affect.longingDays` 有键无 UI（⚠️，不是写错文件，是设置页改不到）。
5. **明确没做到的三处**：
   - `memory.enabled`：`normalizeMemory` 不返回该字段（`packages/memory/src/config.ts:47-68`），5 份 config.json 也没有；记忆无法从配置关闭 ❌。
   - `seed.name`：5 条鱼都已命名，`client.js:1420` 的输入框只在名字为 `fish-*` 时出现；改名走 `POST /fish/:id/name`（写 `meta.json`），不是 config.json。
   - `@` 的 uid/昵称：属于 `bili-auth.json`（`packages/bilibili/src/auth.js:17-19`），不是 config.json；当前该文件**不存在**。
6. **读取仍会碰全局接口**：打开设置页确实请求 `GET /browse`（`client.js:560`）和 `GET /bili`（`client.js:564`），但只作回退/账号来源；**若 `GET /fish/:id` 失败，会静默回退到全局 `cfg`（`client.js:563/565`、`1039-1044`），而保存仍写单鱼文件** —— 这是唯一实质性的读写不一致风险。

## 2. 必须核对的路由

| 路由 | 实现位置 | 实际数据源 / 落点 | 结论 |
|---|---|---|---|
| `GET /fish/:id` | `resources/fish.js:50-55` | `fishView`（`views.js:13-14`）→ `fishConfigView`（`fishcfg.js:144-160`）→ `configFor`（`122-140`）→ `creatures/<id>/config.json` | ✅ 已实现，返回单鱼合并配置 |
| `POST /fish/:id/config` | `resources/fish.js:62-71` | `writeFishConfig`（`fishcfg.js:106-116`）→ `fishConfigPath`（`18-20`）= `creatures/<id>/config.json` | ✅ 写单鱼文件，写完清缓存 |
| `GET /fish/:id/browse` | `resources/fish.js:152-155` | `browseStatus(c, configFor(cfg, c))` | ✅ 用单鱼配置 |
| `GET /fish/:id/bili` | `resources/fish.js:184-187` | `commentStatus(c, configFor(cfg, c))` | ✅ 用单鱼配置 |
| `GET /fish/:id/memory` | `resources/fish.js:150` | `memoryDetail`（`views-memory.js:157-161`），内部 `configFor(cfg, creature)`（`159`） | ✅ 用单鱼配置 |
| `GET /requests` | `resources/requests.js:2-6` | 仅 `parts[0] === 'requests'` 才处理，不会兜住其它 GET | ✅（`/requests/x` 也会命中，无实际影响） |
| `POST /browse` | `resources/browse.js:18-26` | `cfg.browse` → `saveUiConfig`（`settings.js:44-50`）= `~/.fishbowl/ui-config.json` | ⚠️ 全局写；UI 已不再调用 |
| `POST /bili` | `resources/browse.js:34-51` | `comment` → `ui-config.json`；`auth` → `bili-auth.json`（`auth.js:105-129`） | ⚠️ 全局写；UI 只用它存账号（`client.js:658`） |
| `POST /fish/:id/browse/run` | `resources/fish.js:169-183` | 返回 `status: browseStatus(c, cfg)`（`181`）——状态用全局 | ⚠️ 状态回包与单鱼配置不一致 |
| `POST /fish/:id/bili/scan` | `resources/fish.js:188-192` | 返回 `commentStatus(c, cfg)`（`190`）——状态用全局 | ⚠️ 同上 |
| `fishView.browse` | `views.js:44` | `browseStatus(c, cfg)` 全局 | ⚠️ 仅状态，非设置回填 |

> 结论：**GET 全部按单鱼读、POST 全部按单鱼写，没有问题**；全局 `POST /browse`、`POST /bili` 仍在，但 UI 不再用它们改设置。全局接口的残留读（`/browse`、`/bili`）只用于回退和账号。

## 3. 设置项总表

缩写：**R** = `GET /fish/:id` → `configFor` → `creatures/<id>/config.json`（`fish.js:50-55`）；**W** = `POST /fish/:id/config` → `writeFishConfig` → 同一文件（`fish.js:62-71`）。
UI 位置均指 `packages/plugin/client.js`（行号 + 控件名）。

| 设置项 | UI 位置（client.js） | 读取接口→文件 | 写入接口→文件 | 状态 |
|---|---|---|---|---|
| 上网.requirePermit | 694 `Toggle`「看 B 站前要先得到我同意」 | R → 单鱼 config.json | W → 单鱼 config.json | ✅ |
| 上网.window | 700 / 702 两个 `time` | R | W | ✅ |
| 上网.perDay | 709 `number`「每天最多几次」 | R | W | ✅ |
| 上网.topN | 710 `number`「一次看几条」 | R | W | ✅ |
| 上网.deepRead | 711 `number`「每条深读几条热评」 | R | W | ✅ |
| 上网.danmaku | 712 `number`「每条抽几条弹幕」 | R | W | ✅ |
| 上网.sources | 717 `checkbox`×3（`sourceBox` 618-632） | R | W | ✅ |
| 上网.keywords | 720 `input` | R | W | ✅ |
| 上网.avoid.keywords | 725 `input` | R | W | ✅ |
| 上网.avoid.minDuration | 729 `number` | R | W | ✅ |
| 上网.avoid.upMids | 无 | R | W | ⚠️ 有键无 UI |
| 上网.pacing.minIntervalMs | 740 `number` | R | W | ✅ |
| 上网.pacing.jitterMs | 747 `number` | R | W | ✅ |
| 上网.enabled | 状态页能力开关 1240-1245（本页 761 只显示文案） | R | W（经 `fishcfg.js:69` 由 capabilities 同步） | ⚠️ 无直接开关；若 enabled=false 而能力=true，页面出现但无法恢复 |
| 上网.grantDetect / rankingTids / historyDays | 无 | R | W | ⚠️ 有键无 UI |
| 说话.enabled | 827 `Toggle`「在 B 站说话」 | R | W | ✅ |
| 说话.requirePermit | 845 `Toggle` | R | W | ✅ |
| 说话.autoApprove | 无 | R | W | ❌ 有键有默认，无 UI |
| 说话.perDay | 831 `number` | R | W | ✅ |
| 说话.replyPerDay | 832 `number` | R | W | ✅ |
| 说话.replyToReplies | 849 `Toggle` | R | W | ✅ |
| 说话.scanEveryMin | 833 `number` | R | W | ✅ |
| 说话.window | 837 / 839 两个 `time` | R | W | ✅ |
| 说话.atOwner | 859 `Toggle` | R | W | ✅ |
| 说话.@ uid / 昵称 | 854 / 855 `input` | `GET /bili` → `bili-auth.json`（`browse.js:36`、`auth.js:17-19`） | `POST /bili` → `bili-auth.json`（`client.js:658`、`browse.js:46-48`） | ⚠️ 不在 config.json；当前 `bili-auth.json` 不存在 |
| 作息.wake.enabled | 1315 `Toggle` | R | W | ✅ |
| 作息.wake.activeWindow | 1321 / 1323 两个 `time` | R | W | ✅ |
| 作息.wake.interval | 1329 `select` + 1330/1331 `input` | R | W | ✅ |
| 作息.wake.idleSkip | 无 | R | W | ⚠️ 有键（true）无 UI |
| 作息.contact.window | 1368 / 1370 | R | W | ✅ |
| 作息.contact.dailyMax | 1376 `number` | R | W | ✅ |
| 作息.contact.minGap | 1382 `input` | R | W | ✅ |
| 作息.contact.unansweredStop | 1387 `number` | R | W | ✅ |
| 作息.contact.burst / requireReason | 无 | R | W | ⚠️ 有键无 UI |
| 作息.selfTime.enabled | 1339 `Toggle` | R | W | ✅ |
| 作息.selfTime.window | 1345 / 1347 | R | W | ✅ |
| 作息.selfTime.dailyMax | 1353 `number` | R | W | ✅ |
| 作息.selfTime.minGap | 1359 `input` | R | W | ✅ |
| 作息.selfTime.idleWaitMs | 无 | R | W | ⚠️ 有键无 UI |
| 作息.diary.enabled | 无 | R | W | ⚠️ 有键（true）无 UI |
| 作息.diary.start / end | 1395 两个 `time` | R | W | ✅ |
| 作息.diary.catchUp | 1396 按钮 | R | W | ✅ |
| 作息.affect.guiltDays | 1401 `number` | R | W | ✅ |
| 作息.affect.negativeDays | 1403 `number` | R | W | ✅ |
| 作息.affect.longingDays | 无（1402 是空行，原控件被删） | R | W | ⚠️ 有键且参与半衰期，无 UI |
| 人设.growth | 1440 `range`（读取 1049 / 1062） | R | W | ✅ |
| 人设.seed.background | 1433 `textarea`（born 后 disabled，1419/1433） | R | W | ✅ |
| 人设.seed.name | 1423-1427 `input`，仅名字为 `fish-*` 时显示 | 走 `POST /fish/:id/name`（`fish.js:110-117`）→ `meta.json` | ⚠️ 5 条都已命名，无入口 |
| 记忆.turnsPerRecord | 233 `number` | R → 单鱼 config.json | W → 单鱼 config.json | ✅ |
| 记忆.consolidateCap | 234 `number` | R | W | ✅ |
| 记忆.recallPool | 238 `number` | R | W | ✅ |
| 记忆.injectBudget | 239 `number` | R | W | ✅ |
| 记忆.memoryRatio / turnRatio | 242 / 244 `number` | R | W | ✅ |
| 记忆.herSummaryOnPlainTurns | 250 `checkbox` | R | W | ✅ |
| 记忆.searchTool | 254 `checkbox` | R | W | ✅ |
| 记忆.singleWriter | 259-268 `select` | R | W | ✅ |
| 记忆.embeddings.enabled | 272-276 `checkbox` | R | W | ✅ |
| 记忆.embeddings.model | 282-287 `input` | R | W | ✅ |
| 记忆.embeddings.baseUrl | 289-294 `input` | R | W | ✅ |
| 记忆.neutralModel | 299 `input` | R | W | ✅ |
| 记忆.tags | 303 `input`（解析 178/216） | R | W | ✅ |
| 记忆.enabled | 无 | —（normalize 丢弃） | —（写了也丢） | ❌ `memory/src/config.ts:47-68` 不返回该键；5 份文件都没有 |
| 能力.capabilities.browse | 1239-1243 按钮（tab 隐藏 1232） | R（`/fish/:id` 的 `config.capabilities`） | W（`{capabilities:...}`，`1242`） | ✅ 与 browse.enabled 写时联动；读时无反向同步 |

## 4. 每条鱼缺失的 key

顶层 12 键（growth / seed / wake / contact / selfTime / memory / browse / comment / capabilities / diary / affect / relation）与 browse 14 子键、comment 9 子键、wake/contact/selfTime/diary/affect 子键在重写后均齐全。缺的只有：

| 鱼（creatureId 前 8 位） | 缺失 key |
|---|---|
| 187ea39d | `seed.name`、`seed.background`（`seed: null`）；`memory.enabled` |
| 5d179c96 | 同上 |
| 86b56476 | 同上 |
| bbec32a5 | 同上 |
| e0efd33e | 同上 |

说明：`memory.enabled` 在 `MEMORY_DEFAULTS`（`memory/src/config.ts:33`）里存在，但 `normalizeMemory` 不输出，所以永远不会落盘，读回来也会被丢；`memory/tool.js:69` 检查的 `capabilities.memory` 从未被 `normalizeConfig`（`config.js:76-81`）生成 —— 两个"记忆开关"都是死键。
另：审计刚开始时 86b56476 的 `comment` 只有 `requirePermit` 1 个键，21:33:52 被运行中的进程整份重写补齐为 9 键；说明旧进程仍在写盘（见风险 1）。

## 5. 仍未实现 / 有风险的点（按严重程度）

1. **【高】读失败静默回退全局，写仍落单鱼**：`client.js:563/565`（browse/comment）与 `1039-1044`（growth/seed/作息）在 `GET /fish/:id` 失败时用 `/fish`、`/browse`、`/bili` 的全局 `cfg` 回填；用户一改就把全局默认值写进这条鱼的 config.json。后端已是新版 404 不会发生，但这是"看起来读了 A、实际写了 B"的唯一通道。
2. **【高】出生后 seed 仍可经 API 改写**：`POST /fish/:id/config`（`fish.js:62-71`）没有 born 检查，`pickFishPatch` 也直接收 `seed`（`fishcfg.js:54-59`）；UI 只是用 `disabled`（`client.js:1433`）挡住。全局旧路由有 A1 保护（`resources/config.js:32-35`），单鱼路由没有，违背"来历只读"。
3. **【中】单鱼记忆配置没有语义校验**：UI 自动保存直接 POST（`client.js:171/218`），服务端只 normalize 钳制，不调用 `validateMemory`；`recallPool < memoryRatio + turnRatio` 这类矛盾值会静默写进 config.json（全局 `/memory/config` 是校验的，`config.js:13`）。
4. **【中】`browse.enabled` 与 `capabilities.browse` 只有单向联动**：关能力时写 `browse.enabled=false`（`fishcfg.js:63-70`），但打开能力才写回 true；若磁盘上出现 `enabled=false` + `capabilities.browse=true`（手改、迁移、旧数据），设置页会显示上网页（`client.js:1232`）、但"让她现在去刷一次"永远禁用（`892`），且没有开关可修。
5. **【中】状态回包用全局配置**：`fish.js:181`、`190` 和 `views.js:44` 用 `cfg` 而不是 `configFor`，`browseStatus/commentStatus` 里的 perDay、配额显示可能取到别的鱼/全局值；UI 会把它当这条鱼的状态显示（`client.js:649`、`684`）。
6. **【低】UI 文案与实际相反**：上网页顶部写"设置对所有鱼生效"（`client.js:881`），实际 browse/comment 都是按鱼存；会误导。
7. **【低】有键无 UI 的一整批**：`autoApprove`、`idleSkip`、`diary.enabled`、`longingDays`、`burst`、`requireReason`、`idleWaitMs`、`grantDetect`、`rankingTids`、`historyDays`、`avoid.upMids` —— 只能手改 config.json。
8. **【低】全局写接口残留**：`POST /browse` 写 `ui-config.json` 的 browse（`browse.js:18-26`）、`POST /bili` 写 comment（`browse.js:39-45`）；UI 已不用，但任何旧客户端/脚本调用会改到"默认层"，影响还没有单鱼覆盖的鱼。
9. **【低】运行中的旧进程会重写 config.json**：审计期间 5 份文件在同一秒被整份重写；如果设置页此时写入，存在"读-改-写"覆盖窗口（`writeFishConfig` 先读后写，无锁）。
10. **【低】`GET /fish/:id/config` 已实现（`fish.js:63`）但 UI 从不调用**；设置页只依赖 `GET /fish/:id`，一旦该路由形状变了没有第二条读取路径。

## 6. 边界

- 本报告未启动/调用任何 HTTP 接口，也未验证浏览器实际渲染；行号以当前工作区源码为准。
- 只读了一个配置样例的完整值来确认键存在；未鉴权、未修改任何代码或 creatures 配置。
- 若要确认"设置页在跑的版本"就是本报告审计的版本，需要完全退出 DSH 后重启再看 `/debug/services`（`browse.js:130-133`）。
