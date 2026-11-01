# 0.3.2 之后的结构体检

数据来自 `scripts/dev/arch-report.mjs` 与代码统计。

## 一、已经干净的部分

- **依赖图无环**：`plugin(入口) → adapter-dsh → app → {being, memory, affect, bilibili, schedule, journal, voice}`；`bridge-qq` 只依赖 app 与能力包
- 兼容层已删干净（`src/core` 不存在，`plugin/lib` 只剩 `types.js` 和两个工具）
- 设置页后端从 666 行降到 `http.js` 58 行 + 三个资源模块
- 用例层拆过一次：`turn.js` 471→310，`wake.js` 296→175
- 测试改成以退出码判定（`scripts/dev/test-all.mjs`），不会再出现"崩溃被当成全绿"

## 二、仍然偏重的文件

| 文件 | 行数 | 说明 |
|---|---|---|
| `plugin/client.js` | 1272 | 页面已函数化，但共享 UI 与「住所」页仍占大头 |
| `bilibili/src/client.js` | 516 | HTTP 请求 + 节奏控制 + 响应解析混在一个文件 |
| `memory/src/memory.ts` | 478 | 记录、合并、检索、渲染、快照都在一个类里 |
| `being/src/creature.ts` | 328 | 账本重放 + 住处 + 承诺 + 日记/纸条/请求 + 许可 + 活动 |
| `app/src/turn.js` | 310 / 17 个 import | 编排层，知道的能力仍然多 |
| `adapter-dsh/src/host.js` | 291 | 唯一碰 DSH 的文件，规模合理 |

## 三、具体耦合点

### 1. 两套状态块渲染（最该合）

`app/src/injector.js` 的 `summaryText` 与 `memory/src/render.ts` 各写一份：

- 都以 `[fishbowl 状态]` 开头
- 都有六个旋钮的同一段格式
- 只有 `bridge-qq/lib/pipeline.js` 还在用 `summaryText`（公开/私聊兜底）

两份格式一旦漂移，同一条鱼在 DSH 和 QQ 里"状态"长得不一样。

**建议**：抽 `app/state-block.js`，或给 `memory.render` 加"无记忆"模式，QQ 桥直接用。

### 2. `app` 直接依赖 `bilibili` 的内部模块（7 条）

`turn.js` / `turn/after.js` 直接 import `bilibili/src/store.js`（今天看了什么）、`comment.js`（扫回复）。这些是浏览能力**内部**的存储与流程，用例层不该知道它们怎么存。

**建议**：`bilibili` 暴露一个 facade（`todayItems` / `scanReplies` / `lookForCreature`），app 只依赖 facade；内部文件不对外。

### 3. 配置 schema 分散在四个包

加一个配置项现在要动：`app/config.js`（归一化）、`app/cfgkeys.js`（键校验）、`app/fishcfg.js`（按鱼合并），外加 `memory/config.ts` 或 `bilibili/browse.ts`。

**建议**：每个能力包导出自己的 `normalize + pick`，`app` 只做组合与按鱼覆盖。

### 4. `app/memory-store.js` 放错包

"每只鱼一个 Memory 实例"的缓存和宿主无关，属于 memory 包的对外用法。现在在 app，只是因为 `configFor` 在 app。

**建议**：memory 包接收一个 `configFor` 回调，自己提供 `createStore`。

### 5. `being/creature.ts` 是个大门面

账本重放、住处、承诺、日记/纸条/请求、许可、活动全在一个类上。调用方要读半天才知道有哪些能力。

**建议**：按 facet 拆成函数（`commitmentsOf(creature)` / `diaryOf(creature)` …），`Creature` 只保留重放与元数据。

### 6. 遗留的示例配置

`src/config.json` 是早期的示例 wake/contact 配置，和 profile 里的 `cordis.patch.yml` 重复。

**建议**：删掉，或移到 `docs/examples/`。

## 四、测试的结构性问题

1. **没有模块加载检查**：0.3.1 的启动错误（少一层相对路径）测试没拦住——因为测试只 import 了部分入口。建议加 `scripts/dev/check-imports.mjs`，把 `index.js`、`host.js`、`http.js`、`turn.js`、`wake.js`、两个工具全部 import 一遍，放进 `test:all`。
2. **`turn/after.js` 只有间接覆盖**：日记、纸条、请求的真实写入路径（要 LLM）没有被单测覆盖，建议给它注入假 LLM 做单元测试。
3. **测试文件偏大**：`plugin/test/unit.test.ts` 600+ 行，按域拆成 `core.test.ts` / `config.test.ts` / `http.test.ts` 会更好定位。

## 五、不建议现在做的

- 把 `turn.js` 拆得更细（它是用例编排，知道能力是应该的）
- 把 `client.js` 拆成多个文件（DSH 客户端插件是拼进一个 chunk 执行的，不支持相对 import）
- 改账本格式或事件命名

## 六、优先级

| 优先级 | 动作 | 风险 |
|---|---|---|
| P0 | 合并两套状态块渲染；加模块加载检查 | 低 |
| P1 | `bilibili` facade 收口；`src/config.json` 清理 | 低 |
| P2 | 配置 schema 下沉到各能力包 | 中 |
| P3 | `memory-store` 归位；`creature` 拆 facet | 中 |
| P4 | 测试按域拆分 | 低 |

进度：P0（模块加载检查）与「跨包只走接口」在 0.3.3 完成；src/config.json 已移到 fixtures。P1 的 bilibili facade 收口、P2/P3 待做。
