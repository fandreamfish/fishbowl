# 0.3.7 之后的结构体检

## 一、已经稳的部分

- **依赖图无环**，方向固定：`plugin → adapter-dsh → app → {being, memory, affect, bilibili, schedule, journal, voice}`
- **接口强制**：`check:interfaces` 保证跨包只能 import 对方 `src/index`；`check:imports` 保证 11 个入口都能真实加载
- **配置 schema 跟着能力走**：作息在 `schedule`、日记在 `journal`、半衰期在 `affect`、评论在 `bilibili`；`app` 只组合
- **状态块只有一份**：`memory/src/render.ts` 的 `renderStateBlock`，QQ 桥与 DSH 共用
- **记忆实例缓存归位** `memory`，`app` 只剩接线
- **`Creature` 回到门面**：日记/纸条/请求已是 facet

## 二、还偏重的文件

| 文件 | 行数 | 评价 |
|---|---|---|
| `plugin/client.js` | 1272 | 页面已是函数，其中 `renderHome` ~174 行、`renderRoutine` ~145 行 |
| `bilibili/src/client.js` | 516 | HTTP 请求 + 节奏 + 解析 + 签名混在一起 |
| `memory/src/memory.ts` | 478 | 记录/合并/检索/渲染/快照在一个类，但方法边界清楚 |
| `being/src/creature.ts` | 311 | 已减负；剩余是重放 + 住处 + 承诺 + 活动 |
| `app/src/turn.js` | 310 / 17 import | 用例编排，知道能力是正常的 |
| `adapter-dsh/src/host.js` | 291 | 唯一碰 DSH 的文件，规模合理 |

## 三、剩下的真实耦合

### 1. `app` 仍直接使用 `bilibili` 的存储/流程动词（8 条）

`turn/after.js` 用 `todayItems`、`countToday`、`scanDueReplies`、`markReplySeen`；`wake.js` 还多一个 `markSelfTime`。虽然已经走包入口，但这些都是"浏览能力内部怎么存/怎么扫"的名字。

**建议**：`bilibili` 入口改成语义门面（`todayMaterials()` / `scanReplies()` / `startSelfTime()`），低层的 `store`/`comment` 不再从入口导出。

### 2. `plugin/client.js` 的两个大页面

`renderHome`（174 行，含搬家弹窗）与 `renderRoutine`（145 行，含四张设置卡）。受"单文件加载"限制不能拆文件，但可以在同文件内抽 `MoveDialog`、`RoutineCards` 两个子组件。

### 3. 死导出

全仓扫描只剩四个真正没人用的导出：

- `bilibili/src/browse.js` → `gather`
- `bilibili/src/browse.ts` → `isBvid`
- `bilibili/src/guard.js` → `safeMaterialText`
- `bilibili/src/store.js` → `lastSeenAt`

（`proactivePrompt`、`shouldRecordAbsence`、`detectRevoke` 等只在测试里用，不算死。）

### 4. 测试文件偏大

- `plugin/test/unit.test.ts` 615 行
- `memory/test/unit.test.ts` 259 行
- `plugin/test/browse.test.ts` 253 行

出问题时定位靠搜索。建议按域拆：`core` / `config` / `http` / `wake`。

### 5. 工具脚本的标签过时

`arch-report.mjs` 还把所有 `src/` 文件标成「src(兼容层)」，但兼容层早已删除，`src/` 现在只有 demo/test/夹具。纯显示问题。

## 四、没有发现的问题

- 没有循环依赖
- 没有跨包直接引内部文件
- 没有重复的状态块/配置归一化
- 没有"模块加载失败要靠启动才发现"的盲区（已有 `check:imports`）

## 五、优先级

| 优先级 | 动作 | 风险 |
|---|---|---|
| P0 | 删四个死导出；修 `arch-report` 标签 | 低 |
| P1 | `bilibili` 入口改语义门面 | 低-中 |
| P2 | `client.js` 内抽 `MoveDialog` / `RoutineCards` | 中（要刷新验证） |
| P3 | 测试按域拆分 | 低 |

结论：结构层面没有硬伤，剩下的都是"文件大小"和"命名语义"的洁癖型优化。建议只做 P0，P1–P3 等你确有需求时再说。
