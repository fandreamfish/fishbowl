# 待办：使用中发现的问题

> 用途：用户在实际使用中提出的问题与优化点，先如实记录，之后按优先级排期。
> 记录原则：只写观察到的事实和位置线索，不写未验证的猜测；修完把状态改成「已修」并附 commit / 版本。
> 编号：`T-001` 起，只增不删；不做也要留一条「不做」并写理由。

状态取值：`待办` / `在做` / `已修` / `不做` / `待确认`（信息不足，等用户补充）

## 清单

| 编号 | 记录日期 | 问题（现象 → 预期） | 位置线索 | 影响 | 状态 |
|---|---|---|---|---|---|
| T-001 | 2026-11-02 | 关掉「能不能上网」后，上网页里的其它控件仍然能点、能改 → 期望整页灰掉/消失，或直接跳回状态页 | `client.js:1241` 只从 tab 列表里摘掉「上网」；页面 body 不判断 `caps.browse`；`BrowsePanel` 没有 enabled 入参 | 中（设置改了但看起来没生效，容易误以为还开着） | 待办 |
| T-002 | 2026-11-02 | 关掉上网能力后，鱼依旧能上网、刷 B 站 → 期望她既拿不到工具，也看不到新素材 | 能力只拦两个鱼专用工具：`lib/browse/tool.js:65`、`lib/browse/speak-tool.js:63`；宿主自己的 shell / 网络工具不拦（详见下） | 高（开关承诺了"不上网"但做不到） | 待确认（需复现口径） |
| T-003 | 2026-11-02 | 想把鱼塘抽成独立程序：不依赖 DSH 也能跑，并能接 DSH / QQ / 其它程序作为外部通道 → 期望一个常驻内核进程 + 可插拔装置 | 内核 7 个包已经与 DSH 无关；卡在入口（`plugin/index.js` 的 `apply` 是唯一装配处）、协议、工具执行、UI、模型调用五件事；详见下 | 高（架构级，决定后面所有通道的写法） | 待办 |

## 详情

### T-001 「能不能上网」关掉后页面不灰

现状（0.14.9 源码）：

- `client.js:693-711`：上网页顶部那张卡只有标题「能不能上网」和一句提示（"开关在「状态 → 能力」里"），**本身没有开关**。
- 真正的开关在 `client.js:1248-1252`（状态页 → 能力，按钮显示 开/关）。
- 关掉后 `client.js:1241` 只做了一件事：把「上网」tab 从列表里去掉。
- 但 `view.page` 如果还是 `'browse'`，页面 body 照旧渲染 `BrowsePanel`（`client.js:1422`），里面所有输入、按钮都还是可用的；也没有「已关闭」的替代态。
- `BrowsePanel`（`client.js:495` 起）里没有任何 `enabled` 判断，控件全部无条件渲染。

建议：能力关闭时——① 页面切回「状态」；② 即使停留在该页也整体灰掉/换成一句「上网已关闭（去状态页打开）」；③ 顺手把「能不能上网」那张卡做成真正的开关，别让人去状态页找。

### T-002 关了能力还能刷 B 站

已核对的门在哪：

- `lib/browse/tool.js:65`：`fcfg.capabilities?.browse === false` → 直接返回「我现在不上网。」
- `lib/browse/speak-tool.js:63`：同一条判断，返回「我现在不上网，也就不在外面说话。」
- `bilibili/src/runtime.js:40`：`!cfg.browse.enabled` → 不发请求。
- `app/src/fishcfg.js:142-146`：`configFor` 以 `capabilities` 为权威同步 `browse.enabled`——所以写 `capabilities.browse=false` 的路径是通的。
- `plugin/index.js:95-110`：能力全关时会把三个工具注销。

所以「还能刷」只可能走下面几条缝，需要用户给一个复现口径（哪条鱼、大概时间、她说了什么/设置页显示了什么）才能定位是哪条：

1. **宿主的 shell / 网络工具没被拦**：能力只管 `fish_bili_look` 等鱼专用工具；鱼有 shell 和网络权限（`app/src/constraints.js` 只拦写保护和危险命令，没有按能力拦网络），她自己 `curl` B 站绕开整个工具层。这是结构性的，不是写错了。
2. **旧进程 / 旧前端**：改完不重启 DSH 时，运行中的进程可能还按旧配置跑；浏览器缓存旧 `client.js` 也可能出现"看起来关了、实际写的不是这个键"。
3. **她的说法不是事实**：工具被拒后她仍可能在回复里说"我去看了/看到 XX"——账本里没有对应的 `browse` 记录。判据：`creatures/<id>/browse/seen.ndjson` 有没有新行。

当前数据（2026-11-02 19:0x 核对）：三条有 `browse/seen.ndjson` 的鱼，最后一条记录分别是 11-01 08:23、11-01 13:01、11-01 20:27，**今天没有新的浏览记录**。所以 T-002 要么发生在 11-01 之前，要么属于上面第 1/3 条。

### T-003 鱼塘独立成程序，DSH / QQ 等退化为外部通道

> 口径：这里的"外部设备"理解为**外部程序/通道**（DSH 会话、QQ、B 站、以后的微信/桌面宠物/硬件）。如果是指串口、机器人这类硬件，还得再加一层设备适配，不在本条的默认范围内。

**已经具备的条件**（不是从零开始）：

- 内核 7 个包 `affect / memory / being / schedule / journal / voice / bilibili / app` 全部零 DSH 依赖，分层检查也强制了这一点。
- `docs/HOST.md` 已经把宿主抽象成一小组动词（`onSessionEvent` / `agentFor` / `inject` / `wake` / `voice` / `guard` / `registerTool` / `registerRoute` / `stateDir`）；四个装配模块（collector / constraints / wakeLoop / uiRoute）只认这个 host 接口。
- `packages/bridge-qq` 已经是**第二个进程、同一份账本**（OneBot 实现），证明"多装置共用一个体"在数据层是通的；`outbox.json` 里已经有 `channel` 字段。
- 单写者锁 `memory/src/lock.ts` 的 `acquireWriterLock` 已经在，多进程写账本有约束工具。

**缺的五件事**（这才是"独立"的实际工作量）：

1. **没有独立入口**：装配全部发生在 `packages/plugin/index.js` 的 `apply()` 里，它由 DSH 调起。独立后需要一个自己的进程（`apps/server` 或 `packages/server`）：读配置 → `createBinding` → collector / wake / UI 路由 → 监听本地 HTTP/WS → 优雅退出。
2. **只有单向契约**：现在内核只管"向 host 要动词"，没有"内核 → 装置"的协议。多装置下需要一个消息总线：`session`（谁说了一轮）、`deliver`（她想说，投给哪个 device）、`wake`、`tool` 四类消息，带 deviceId，能断线重连、能补投（outbox 已有基础）。
3. **工具在哪执行**：现在 `guard` / `preExecute` / `registerTool` 都是宿主的能力——DSH 给工具，fishbowl 只拦。独立后要么内核自带工具运行时（shell / 文件 / 网络，要自己划沙箱），要么把"工具"定义成协议、由装置执行（DSH 装置用 DSH 的工具，QQ 装置没有工具）。**这条决定"许可"和 T-002 的落点**，必须先定。
4. **UI**：设置页现在是 DSH 的 settings.section + `registerRoute`。独立后要变成普通本地 Web 页（`/fishbowl-ui/*` 路由本身已经与 DSH 无关，S 里只是少了个入口），前端 `client.js` 基本可复用。
5. **模型调用**：现在由宿主出 LLM。独立进程要自带 provider（deepseek-chat / 其它），以及每只鱼的 `meta.model` 解析、重试、成本记账。

**建议的分步**（每步都能单独验证，不用一次做完）：

1. 抽出 `packages/server`（或 `apps/server`）：把 `plugin/index.js` 的装配搬进去，先只暴露 `/fish`、`/fish/:id/config`、`/fish/:id/memory`、`/requests` 这些已有路由——等于把现在的 UI 后端单独起一个进程。
2. 把 DSH 插件改成薄装置：只转发 `session/event`、做 `inject`/`wake`/`voice`，所有状态读写走 HTTP。
3. 加协议层（WS + deviceId + 补投），把 bridge-qq 从"独立小实现"改成"标准装置"，验证第二台装置确实不用碰内核。
4. 最后再决定要不要给内核自带工具运行时（第 3 条）。

**风险**：

- 跨进程后账本并发写变多，单写者锁要真的用起来，否则 `config.json` 的读-改-写窗口会放大。
- `scripts/dev/check-layers.mjs` / `check-interfaces.mjs` 的分层表要跟着改，新包必须落在正确层级。
- 工具运行时的沙箱是安全边界问题：现在靠 DSH 的 sandbox，自己实现要重新论证（她本来就有 shell 权限）。
- 独立后再接 DSH，"一台 DSH 多个鱼"和"一台鱼多个 DSH"的会话映射要定清楚（现在一条鱼 = 一个会话，见 `docs/LEARNING.md` 第 1 节的不变量）。

