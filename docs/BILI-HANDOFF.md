# 交接：给 fishbowl 实现「刷 B 站」

> 给接手会话看的。先读 `README.md`、`docs/STATE.md`、`docs/MEMORY.md`、`docs/HOST.md`。
> 这次只讨论实现方案与落地步骤，不要求你先把代码写完。

## 0. 一句话

让她能自己去 B 站：**看首页推荐、搜东西、顺着推荐往下看、看视频画面、偶尔留一句话**；并且这套能力要能被她的清醒节律自主调用（不是只在你点按钮时跑）。

## 1. 现在的结构（m17）

```
src/core/            认知内核（零宿主）：情绪、记忆驱动、住处、节律
packages/memory/     记忆模块（纯 TS）
packages/plugin/
  host/dsh.js        唯一碰 DSH 的地方（事件流/注入/唤醒/工具注册/标题/枚举/HTTP 路由）
  memory/            memory_search 工具 + 进程内记忆实例
  lib/               回合管道、注入、绑定、声音、约束、设置页后端
  client.js          设置页前端
packages/bridge-qq/  QQ 桥
scripts/             CLI、dev/ 调试、smoke/ 冒烟
```

工具注册的现成范式：`packages/plugin/memory/tool.js` + `host.registerTool(def)`
（零依赖，直接给 JSON Schema；`exec.agent` 拿会话）。

## 2. 目标能力（按优先级）

| 能力 | 说明 | 是否要登录 |
|---|---|---|
| `bili_look` | 首页推荐 / 搜关键词 / 看某条视频的详情（标题、简介、标签、热评、弹幕摘要） | 否（匿名可读） |
| `bili_watch` | 取一条视频的若干帧拼成一张图，让她用 `read_image` 看画面 | 否（要 ffmpeg） |
| `bili_speak` | 给视频留一条评论 / 回复别人 | **要**（cookie） |
| 自主出门 | 清醒节律触发：按配额自己去看一会儿，回来写进日记/活动 | 取决于做了什么 |

**明确不做**：点赞/投币/收藏/关注/私信/批量操作。只读 + 偶尔一条评论。

## 3. 必须接受的约束

1. **零依赖**：只用 `node:` 内置（fetch / crypto / zlib / child_process）。不装第三方包。
2. **只读匿名**：匿名读用 `buvid3`（调接口拿，缓存在本地）；没有 cookie 就不能评论，**不要假装能**。
3. **凭据**：cookie 放 `~/.fishbowl/bili-auth.json`，文件权限 0600；日志里打码（`SESSDATA=***`）；**永不进仓库、不进 git、不回显给模型**。
4. **风控**：每次请求有最小间隔（建议 ≥1.5s + 抖动）、失败退避、熔断（连续失败就停一轮）；同一视频详情缓存一段时间。
5. **公开场合**：她在 B 站说的话是公开的（`channels.ts` 的 `public` register）——**不能带任何私聊记忆**，不能复述用户的事。
6. **评论默认要人点头**：第一次实现建议 `bili_speak` 只在设置页开关打开时可用，或者用 `ask_owner` 征得同意再发。
7. **不抄第三方代码**：B 站接口没有官方文档，行为靠本机实测确认；别人的实现可以看行为，不要复制代码（许可证）。

## 4. 建议结构

```
packages/plugin/bili/
  client.js      纯 HTTP 客户端：签名参数、cookie、超时、重试、缓存（不碰 DSH）
  auth.js        登录态读写（0600）、打码、过期检测
  frame.js       ffmpeg 抽帧（子进程 → bytes → 自己写文件）
  tools.js       bili_look / bili_watch / bili_speak 的 JSON Schema 与实现
  schedule.js    何时出门（配额、时段、由头）
```

`client.js` 只依赖 `fetch`，可以单测（mock fetch）；`tools.js` 只做参数校验与格式化。

## 5. 实现要点

### 5.1 匿名读

- 先请求一次 `buvid3`（B 站会在响应头/cookie 下发），缓存到 `~/.fishbowl/bili-cache.json`
- 请求头带 `Referer: https://www.bilibili.com`、`User-Agent`、`Cookie: buvid3=...`
- 视频详情：标题、简介、标签、UP 主、播放量、热评（前 10 条）、弹幕（抽样，不要全量）

### 5.2 抽帧（如果要看画面）

- `child_process.spawn('ffmpeg', [...], { stdio: ['ignore', 'pipe', 'ignore'] })`
- **注意沙箱**：宿主工具沙箱里「捕获子进程 stdout」可能被拒（`EPERM`）。两种解法：
  1. 让 ffmpeg 直接写临时文件（`-y out.png`），读文件后删掉；
  2. 不行就退回 `stdio: 'ignore'` + 输出到文件。
- 拼图：九宫格（3×3），存到 `~/.fishbowl/creatures/<id>/frames/<bvid>.jpg`，返回路径给她用 `read_image`。

### 5.3 评论（要登录）

- 需要 `SESSDATA` 等 cookie；脏数据/过期要能检测（调用一个需要登录的轻量接口验证）
- 发送前：内容长度限制、敏感词粗筛、重复内容防抖（同一条视频一天最多一条）
- 失败分类：登录失效 / 风控 / 网络 / 内容拒绝——都返回可读的原因，不要静默

### 5.4 自主出门（接节律）

- `lib/life.js` 已有清醒节律与 `ContactGate`（配额/时段/最小间隔）
- 出门是一个「活动」：`activity` 事件（started → ended），可写进日记
- 配额建议：每天最多 1–2 次、每次最多看 3–5 条、评论每天最多 1 条
- 回来之后：把「看了什么」写进当天的日记（`diary` 事件），必要时留一张小纸条（`note`）

## 6. 数据

```
~/.fishbowl/creatures/<id>/bili/cache.json     视频详情/搜索缓存（带 TTL）
~/.fishbowl/creatures/<id>/bili/history.json   看过什么（用于去重与"今天看过了"）
~/.fishbowl/creatures/<id>/frames/<bvid>.jpg   抽帧拼图
~/.fishbowl/bili-auth.json                     登录态（0600，不进仓库）
```

## 7. 测试

- `client.js`：mock `fetch`，断言请求参数、缓存命中、退避与熔断、错误分类
- `frame.js`：不依赖 ffmpeg 的单测（注入一个假 spawn），断言参数与失败处理
- `tools.js`：参数校验、格式化输出、无凭据时 `bili_speak` 明确报错
- **不在测试里发真实网络请求**

跑法：

```powershell
node packages/plugin/test/unit.test.ts
node packages/plugin/test/bili.test.ts   # 新增
```

## 8. 验收标准

1. 匿名能看首页推荐与搜索，输出是「她看得懂的一小段」，不是 JSON 转储
2. 没有 cookie 时 `bili_speak` 明确说做不到，不假装
3. 抽帧失败（没装 ffmpeg）有清晰提示，不拖垮其它工具
4. 连续失败会熔断，不会无限重试
5. 评论需要显式开关或征得同意；同一条视频不会重复刷评
6. 不会把用户私事带进公开评论

## 9. 分阶段

| 阶段 | 内容 | 验收 |
|---|---|---|
| M18.0 | `bili_look`（匿名读 + 缓存 + 风控） | 能搜能看详情，测试全绿 |
| M18.1 | `bili_watch`（抽帧拼图） | 能生成拼图并让 `read_image` 打开 |
| M18.2 | `bili_speak`（登录 + 评论/回复） | 有登录态时能发一条，没登录态明确报错 |
| M18.3 | 自主出门（节律 + 配额 + 日记） | 一天 1–2 次，回来有日记 |

## 10. 风险

- **账号风险**：评论/登录走非官方接口，有风控甚至封号可能；只在小号上跑，先只读
- **内容风险**：公开评论代表她，也间接代表用户；默认关闭、显式开启
- **隐私**：cookie 泄露等于登录态泄露，0600 + 不进仓库 + 日志打码
- **依赖风险**：ffmpeg 不在 DSH 运行时里，要先探测再提示用户安装

## 11. 工具名冲突（先查再定）

DSH 里可能已经装了别的插件，注册了同名的 `bili_look` / `bili_watch` / `bili_speak`（比如 dsh-fish）。
动手前先看当前会话的工具列表：如果已经存在，就改用 `fishbili_*` 前缀，或在设置里确认谁生效，**不要静默覆盖**。