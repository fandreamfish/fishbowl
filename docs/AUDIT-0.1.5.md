# 0.1.5 之后的结构体检

数据来自 `scripts/dev/arch-report.mjs` 与代码统计，不是印象。

## 一、现状

### 包与规模

| 包 | 行数 | 说明 |
|---|---|---|
| adapter-dsh | 918 | 宿主适配 + 设置页 HTTP（`http.js` 627 行） |
| app | 1821 | 用例与共享服务（`turn.js` 471、`wake.js` 267） |
| bilibili | 1915 | 浏览能力（`client.js` 516、`comment.js` 286） |
| memory | 1701 | 记忆模块（`memory.ts` 478） |
| plugin | 1853 | 入口 + 前端（`client.js` 1252）+ 工具 |
| being | 695 | 个体与账本 |
| affect | 375 | 纯函数核心 |

### 跨包依赖（次数）

```
plugin → app          23
plugin → bilibili     11
src(兼容层) → affect  14 / being 8 / schedule 6
app → bilibili         8
adapter-dsh → app      6
adapter-dsh → bilibili 6
bridge-qq → app        6
adapter-dsh → plugin   3   ← 反向依赖
plugin → adapter-dsh   2   ← 形成环
```

### 直接问题

1. **adapter ↔ plugin 成环**
   - `adapter-dsh/src/http.js` 导入 `plugin/host/dsh.js`、`plugin/lib/life.js`、`plugin/lib/browse/auth.js`
   - `plugin/index.js` 又导入 `adapter-dsh` 的 host/http
   - 分层检查只拦"由外向内"，同级包之间的环没拦住

2. **兼容层仍在被真实代码使用**
   - 38 个 shim（`src/core/*`、`packages/plugin/lib/*`）
   - `adapter-dsh/http.js` 还在通过 shim 找 wake 与 auth
   - 结果是"真实实现 → shim → 真实实现"的绕路，排查时容易看错文件

3. **`turn.js` 仍是上帝模块**（471 行，20 个 import）
   一轮对话里同时处理：评价、情绪、记忆 observe/render/tick、回忆、许可、身份、日记、纸条、请求、承诺、活动、改名、跨会话同步、工具缓冲。

4. **`http.js` 是"路由 + 业务"**（627 行）
   除了 HTTP 解析，还直接调 `lookForCreature`、`wakeTrigger`、记忆视图、配置写入、风险状态。

5. **`wake.js` 混了三种东西**（267 行）
   节律决策（什么时候醒）、配额（能不能开口）、副作用（自处、扫评论、标记已读、写状态文件）。

6. **`client.js` 单文件 1252 行**
   七个页面 + 弹窗 + 表单全在一个文件，任何一处改动都要读整个文件。

7. **渲染有两套**
   `app/injector.js` 的 `summaryText`（QQ 公开场合与兜底）和 `memory/render.ts` 的预算渲染，各写一份状态块格式。

8. **配置校验分散在四个包**
   `app/config.js`（归一化）、`app/cfgkeys.js`（键校验）、`app/fishcfg.js`（按鱼合并）、`memory/config.ts`（记忆默认值/语义校验）、`bilibili/browse.ts`（浏览配置）。加一个配置项要动 2–3 个包。

9. **记忆实例缓存放在 app**（`app/memory-store.js`）
   它是"每鱼一个 Memory"的宿主无关逻辑，更适合放在 memory 包里。

## 二、优化建议（按收益/风险排序）

### P0 破环（不改行为）

- `http.js` 不再 import `plugin/*`：
  - wake 状态与触发 → 下沉到 `app/wake-api.js`（或 `app/wake.js` 导出纯函数）
  - 登录态读写 → 直接从 `@fishbowl/bilibili` 导入（auth 已经在那里）
  - host 实例 → 由 `plugin/index.js` 注入，adapter 自己创建时用 `adapter-dsh/host` 内部路径
- 分层检查补规则：**同级包之间禁止互相 import**（白名单：plugin → adapter 作为组合根）

### P1 拆模块

- `http.js` → `router.js` + `resources/{fish,config,memory,browse,diary}.js`，每个 ≤150 行；资源层只做参数校验与调用 app
- `turn.js` → `app/turn/`：
  - `record.js`（评价、情绪、turn 落账）
  - `render.js`（记忆渲染与注入指纹）
  - `recall.js`（话题回忆）
  - `after.js`（日记/纸条/请求/承诺/活动/身份/许可/改名/同步）
  - `buffer.js`（会话内缓冲）
- `wake.js` → `wake/plan.js`（由头与配额，纯函数）+ `wake/run.js`（宿主循环与副作用）

### P2 前端与清理

- `client.js` 按页面拆：`pages/{list,status,home,routine,browse,persona,memory}.jsx` + `ui/{Toggle,Card,Field}.jsx` + `api.js`
- 删除 38 个 shim：先把 `plugin/index.js`、两个工具、`adapter-dsh` 改为直接 import 真包，再删 `src/core` 与 `plugin/lib` 的转发文件
- `summaryText` 与 `memory.render` 合并成一个 `app/state-block.js`

### P3 归属调整

- `app/memory-store.js` → `memory/src/instance.ts`（每鱼一个实例的缓存）
- 配置 schema 归各自包：`memory` 管记忆、`bilibili` 管浏览、`app` 只负责合并与按鱼覆盖
- `plugin/lib/constraints.js` → `app/constraints.js`（它只用 bias 与工具名，和宿主无关）

## 三、不建议现在做的

- 不要为了"更纯"把 `turn.js` 拆成十几个包：它是用例编排，本来就该知道很多能力
- 不要在 0.1.x 改账本格式
- 不要把 `client.js` 的重写和逻辑修复混在一个提交里

## 四、下一步

进度：P0 在 0.2.0 完成；P1 在 0.2.1 完成（	urn/after.js、wake/plan.js）；兼容层在 0.2.2 删除；http.js 视图在 0.2.4 抽出（666→384）；client.js 拆分待做。

按 P0 → P1 → P2 分三次发布：

1. `0.2.0`：破环 + 分层检查加强（行为不变，测试全绿）
2. `0.2.1`：拆 `turn.js` / `wake.js`（内部结构，行为不变）
3. `0.3.0`：拆 `client.js`、删兼容层（前端结构与内部 import 路径变化，需要刷新/重启）
