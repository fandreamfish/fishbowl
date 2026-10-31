# fishbowl 联调清单（真机验收）

> 代码阶段已全部完成（m0 → m4）。这份清单是启用插件后的真机验证步骤，按顺序做，任何一项异常就停用插件并贴日志（`~/.fishbowl/creatures/trace.ndjson`）。

## 0. 前置

1. API key 未删（评价/巩固/自我认知/主动联系都要用）；在 profile 的 `cordis.patch.yml` 里给 fishbowl 插件行加 `config.appraiser = { kind: deepseek, apiKey: … }`
2. 插件仍是停用状态 → 在设置里启用（启用即加载最新代码，含 m3/m4）

## 1. 基础链（预计 5 分钟）

- [ ] 开新会话聊 3-4 轮生活话题
- [ ] `~/.fishbowl/creatures/` 下出现新个体目录（meta.json / log.ndjson / projection.json）
- [ ] `trace.ndjson` 每轮一条（含 appraisal / affect / bias）
- [ ] 无任何 `warn` 行；宿主工具（终端/文件）正常，无间歇 Error

## 2. 注入与声音（预计 10 分钟）

- [ ] 聊几轮后，注入块出现：名字（未命名则没有该行）、情绪、倾向、天气/气候声明
- [ ] 同一状态不重复刷屏（只有肉眼可见的变化才注入）
- [ ] 声音：无 AI 免责声明；被否定时简短回应不表演认错

## 3. 记忆与身份（预计 15 分钟）

- [ ] 说"我不喜欢 X / 我喜欢 Y"之类，5 轮后 trace 出现 `consolidated` 事件
- [ ] `log.ndjson` 出现 semantic/procedure 事件
- [ ] 给她起个名字 → trace 出现 `named`，meta.json 的 name 更新
- [ ] 重启 DSH 或换会话，问她名字和"你记得我什么"——应该都对（个体目录是磁盘状态）

## 4. 情绪改变行为（预计 10 分钟）

- [ ] 连续否定她 2-3 次 → 注入里话量/耐心下降，回复变短
- [ ] 说重话伤她 → 她冷落或回怼（"行，不说了"这类）
- [ ] 道歉后她没有立刻翻篇（余温未消）

## 5. 承诺（预计 10 分钟）

- [ ] 请她"明天帮我做 X"并让她答应 → log 出现 commitment 事件
- [ ] 隔几轮抱怨"你怎么还没做" → trace 出现 `commitment-broken`
- [ ] 注入出现 `未完成的承诺: ⚠ …`

## 6. 主动联系（先观察，后打开）

- [ ] 先在配置里开 `wake.enabled = true`（interval 先用 fixed 60m 便于观察）
- [ ] 制造由头：留一个 ⚠ 承诺，或几小时不说话（longing 需真实缺席累积）
- [ ] 时段窗口内她主动发消息；配额不超（每天 ≤2、间隔 ≥3h）
- [ ] 会话关着时：`outbox.json` 出现待投递；重开会话自动补投

## 7. QQ 桥接（可选，小号测试）

- [ ] OneBot（NapCat）配好 WS + HTTP 后跑 `node packages/bridge-qq/index.js --config …`
- [ ] 私聊回复带完整记忆；群里只 @ 才回、且不提私聊内容
- [ ] 与 DSH 插件同时写时，第二个启动者被锁拒绝

## 8. 封存与 CLI（预计 5 分钟）

- [ ] `node scripts/fishbowl-cli.ts list --state-dir C:\Users\24358\.fishbowl\creatures`
- [ ] `freeze <会话id>` → `status` 显示 frozen=true；`unfreeze` 恢复

## 验收通过标准

1-5 全过 = 核心成立；6 全过 = 她真的"活着"；7 是小号可选项；8 是管理能力。
任何一项反复失败 → 对着 git tag 回滚（`m1`、`m2.4`、`m3.3`、`m4` 都是干净回滚点），把 trace 贴回来修。
