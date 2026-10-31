# fishbowl 项目状态与开发要点

> 最后更新：M6.1。这份文档是给"下次开工的人（或 AI）"看的操作手册。
> 密钥类信息**不在本文件**——见同目录 `SECRETS.local.md`（已 gitignore，不进仓库）。

## 1. 项目一句话

DSH 插件。不是记忆插件——记忆是底料，人格是派生。核心是**事件溯源 + 派生投影**：情绪与认知都是事件日志 + 时间的纯函数，随时可重算。

- 个体呼作**她**，当前个体名：大肥鱼
- 一个会话一个个体；状态在磁盘，跟会话无关（"会话是房子，不是人"）
- 五条公理：A1 人格不预设 · A2 价值观只解释不学习 · A3 情绪必须能改变行为 · A4 遗忘是功能 · A5 个体独立

## 2. 环境与路径

| 项 | 路径 |
|---|---|
| 仓库 | `D:\fish-memory` |
| 远程 | `github.com/fandreamfish/fishbowl`（私有） |
| 宿主 checkout | `S:\DeepSeek Harness\resources\app.asar\dsh\` |
| DSH 配置目录 | `C:\Users\24358\.dsh\` |
| profile | `C:\Users\24358\.dsh\profiles\desktop\` |
| 插件配置 | `profiles\desktop\cordis.patch.yml`（fishbowl 段） |
| 个体状态 | `C:\Users\24358\.fishbowl\creatures\` |
| Node | `C:\Users\24358\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe` |
| pnpm | `C:\Users\24358\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs` |
| 代理端口 | **7892**（会变，之前用过 7890；直连在 VPN TUN 开启时也可用） |

## 3. 常用命令

```powershell
# 测试（三套）
& $node D:\fish-memory\src\test.ts
& $node D:\fish-memory\packages\plugin\test\unit.test.ts
& $node D:\fish-memory\packages\bridge-qq\test\unit.test.ts

# CLI（看个体）
& $node D:\fish-memory\scripts\fishbowl-cli.ts list --state-dir C:\Users\24358\.fishbowl\creatures
& $node D:\fish-memory\scripts\fishbowl-cli.ts status <会话id|个体id|名字>
& $node D:\fish-memory\scripts\fishbowl-cli.ts freeze|unfreeze <同上>

# 语法检查（改完 JS 先跑）
& $node --check D:\fish-memory\packages\plugin\index.js
```

## 4. GitHub 访问

```powershell
$tok = "见 SECRETS.local.md"
$url = "https://$tok@github.com/fandreamfish/fishbowl.git"

# 推送（优先代理；失败再直连）
git -c http.proxy=http://127.0.0.1:7892 -c https.proxy=http://127.0.0.1:7892 push $url HEAD:main
git push $url HEAD:main          # 代理不通时
git push $url refs/tags/m6       # tag 单独推

# GitHub API（列目录/下载文件，走代理）
$H = @{ Authorization = "Bearer $tok"; 'User-Agent'='fishbowl-setup'; 'Accept'='application/vnd.github+json' }
Invoke-RestMethod -Uri 'https://api.github.com/repos/fandreamfish/fishbowl/contents/' -Headers $H -Proxy 'http://127.0.0.1:7892'
```

**注意**：
- 推送失败多半是代理端口变了或 VPN 断了——先试代理，再试直连，再问用户端口
- `web_fetch` 访问 raw.githubusercontent.com 会超时；用上面的 API + 代理，或 `Invoke-WebRequest`
- 大仓库目录内容用 API 的 `?ref=` 取；文件内容 base64 解码后写盘

## 5. 密钥（详见 SECRETS.local.md）

| 密钥 | 用在哪 |
|---|---|
| DeepSeek API key | `cordis.patch.yml` 的 `appraiser.apiKey`（deepseek 评价器）；用户稍后会删，删前一切 LLM 功能靠它 |
| GitHub PAT | 推送/API；泄露即轮换 |

**纪律**：密钥只进 `SECRETS.local.md`（gitignored）和 profile 配置文件；永不进仓库、不进对话记录之外的日志、不写进任何 `.md` 提交文件。

## 6. 插件架构（`packages/plugin/`）

| 文件 | 职责 |
|---|---|
| `index.js` | 入口：读 ui-config → normalizeConfig → 约束/收集器/唤醒循环/UI 路由 |
| `lib/collector.js` | 核心闭环：turn/end → 评价 → 记录 → 巩固/自我认知/起名/承诺/活动 → 注入 |
| `lib/appraiser.js` | 评价器（scripted 关键词版 / deepseek LLM 版） |
| `lib/injector.js` | 状态摘要文本 + 注入消息形状（role+id 必带） |
| `lib/binding.js` | 会话 ↔ 个体绑定（bindings.json） |
| `lib/constraints.js` | 工具约束（拒绝 / 先验证再动） |
| `lib/life.js` | 清醒节律 + 主动联系（默认关闭） |
| `lib/ui-route.js` | 设置页后端：`/fishbowl-ui/state|config` |
| `lib/voice.js` | 声音规则（few-shot 熟人腔）+ 关系语域 |
| `client.js` | 设置页前端（`settings.section` 槽位） |
| `src/core/*.ts` | 内核：引擎、个体、存储、调度、通道、承诺、巩固、自我认知 |

## 7. 数据流

```
会话事件 → collector（turn/end）→ 评价器 → episode 事件（log.ndjson）
        → 情绪 fold（projection.json 缓存）→ 6 旋钮 → 注入（下一轮）
        → 巩固/自我认知/起名/承诺 → semantic/self/identity/commitment 事件
        → memorySummary（重量排序 + 折叠）→ 注入
```

## 8. 每条铁律（都踩过）

1. `agent.inject()` 消息必须带 `role` + 唯一 `id`，否则会话永久 422（整场对话死掉）
2. 宿主回调里**绝不抛错**；插件不能挡住工具瀑布流
3. `package.json` **不能有 BOM**——PowerShell `Set-Content -Encoding UTF8` 会写；用 `[IO.File]::WriteAllText`
4. Cordis 服务必须 `inject` 声明，或 `ctx.get('webServer')` 取可选服务
5. patch 里**不要写 `disabled: false`**——会盖掉界面停用
6. 插件**零依赖**（schemastery 已删）；配置只走 patch
7. 同一路由注册两次会激活失败（已容错）
8. 客户端插件：`dsh.client` + `./client` + `window.__ModuleLoader__.load({id:'@local/fishbowl'})`
9. `link:` 安装改源码即生效；`file:` 是副本，改了不生效
10. 每个阶段：测试全绿 → commit → tag → push → 更新进度列表（ROADMAP + GitHub 主页）

## 9. 当前状态

- 阶段：M0–M6 全部完成；`m6.1` 为最新 tag
- 插件：已启用（profile desktop，link 安装）
- 配置：`appraiser=deepseek`、`relation=companion`、`wake.enabled=false`
- 设置页：侧栏应有 fishbowl 项（m5.2 修复后待最终确认停用/启用行为）
- 待办：
  1. 真机验证设置页出现与停用消失
  2. 叫醒消息去祈使句 + 冷落事件化
  3. 记忆分"他说/我的认知" + 五步认知循环
  4. 成长瓶颈制（g 降级为环境参数）
  5. QQ 桥真机联调、B 站通道
- 用户待办：联调完删 DeepSeek key、轮换 GitHub PAT

## 10. 回滚

```powershell
git log --oneline      # 看 tag
git checkout m4        # 回到封存/CLI 阶段
git checkout m6        # 回到记忆折叠阶段
```
