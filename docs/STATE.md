# fishbowl 项目状态与开发要点

> 最后更新：记忆模块抽出之后（M16 + `packages/memory`）。
> 密钥不在本文件，见 `SECRETS.local.md`（已 gitignore）。

## 1. 项目一句话

DSH 插件。不是记忆插件——记忆是底料，人格是派生。核心是**事件溯源 + 派生投影**：情绪是事件日志 + 时间的纯函数，随时可重算。

- 五条公理：A1 人格不预设 · A2 价值观只解释不学习 · A3 情绪必须能改变行为 · A4 遗忘是功能 · A5 个体独立
- 设计：`DESIGN.md`；记忆：`docs/MEMORY.md`；宿主契约：`docs/HOST.md`

## 2. 环境与路径

| 项 | 路径 |
|---|---|
| 仓库 | `D:\fish-memory` |
| 远程 | `github.com/fandreamfish/fishbowl`（私有） |
| 宿主 | **DSH 0.2.1-rc.5**（2026-10-31 升级） |
| 宿主 checkout | `S:\DeepSeek Harness\resources\app.asar\dsh\` |
| DSH 配置目录 | `C:\Users\24358\.dsh\` |
| profile | `C:\Users\24358\.dsh\profiles\desktop\` |
| 插件配置 | `profiles\desktop\cordis.patch.yml`（fishbowl 段） |
| 个体状态 | `C:\Users\24358\.fishbowl\creatures\` |
| Node | `C:\Users\24358\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe` |
| pnpm | `C:\Users\24358\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs` |
| 代理端口 | 7892（会变；直连在 VPN TUN 下也可用） |

## 3. 常用命令

```powershell
$node = "C:\Users\24358\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"

& $node D:\fish-memory\src\test.ts                        # 内核
& $node D:\fish-memory\packages\memory\test\unit.test.ts  # 记忆模块
& $node D:\fish-memory\packages\plugin\test\unit.test.ts  # 插件
& $node D:\fish-memory\packages\bridge-qq\test\unit.test.ts
& $node D:\fish-memory\scripts\smoke\m7-apply-smoke.ts    # 激活冒烟（假宿主）

# CLI
& $node D:\fish-memory\scripts\fishbowl-cli.ts list --state-dir C:\Users\24358\.fishbowl\creatures
& $node D:\fish-memory\scripts\fishbowl-cli.ts status <会话id|个体id|名字>
& $node D:\fish-memory\scripts\fishbowl-cli.ts freeze|unfreeze <同上>

# 调试
& $node D:\fish-memory\scripts\dev\probe-memory.ts <creatureId>   # 看某只鱼的记忆
& $node D:\fish-memory\scripts\dev\read-session.cjs <session.v4.jsonl.zstd>  # 解会话日志
& $node D:\fish-memory\scripts\memory-eval.ts                     # 记忆评测集
```

## 4. GitHub 访问

```powershell
$tok = "见 SECRETS.local.md"
$url = "https://$tok@github.com/fandreamfish/fishbowl.git"
git -c http.proxy=http://127.0.0.1:7892 -c https.proxy=http://127.0.0.1:7892 push $url HEAD:main
git push $url HEAD:main            # 代理不通时直连
git push $url refs/tags/<tag>      # tag 单独推
```

## 5. 结构

```
src/core/            内核（零宿主）：types engine creature store growth tenancy scheduler contact channels recall commitment consolidation selfmodel journal
packages/memory/     记忆模块（纯 TS）：ledger events records consolidate summarize recall render embed lock config
packages/plugin/
  host/dsh.js        唯一碰 DSH 的地方
  memory/store.js    进程内记忆实例（一只鱼一个）
  memory/tool.js     memory_search 工具
  lib/               collector injector binding constraints life config appraiser llm voice journal identity extract ui-route rename
  client.js          设置页前端
packages/bridge-qq/  QQ 桥（OneBot v11）
scripts/             fishbowl-cli llm ab-run memory-eval；dev/ 调试；smoke/ 冒烟
prototype/           Python 原型（冻结）
```

## 6. 数据布局

```
creatures/
  scopes.json            见过的住处（工作区路径 / 会话）
  ui-config.json         设置页保存的成长率与来历
  trace.ndjson           评价轨迹 + 注入/改名记录
  .titles.json           改名前的原标题（搬走时恢复用）
  <id>/meta.json         四条不变量 + occupancy（住处）
  <id>/log.ndjson        账本：turn/summary/merged/retire/revise/revisit/hit/config
                         + 旧情绪事件 episode/semantic/commitment/activity/diary/note/request
  <id>/projection.json   情绪投影缓存（可删可重算）
  <id>/outbox.json       会话关着时攒着的话
```

新记忆模块的 `buildView` 只认自己的事件类型，旧事件共存不冲突。

## 7. 铁律（都踩过）

1. `agent.inject()` 消息必须带 `role` + 唯一 `id`，否则会话永久 422
2. 宿主回调里**绝不抛错**；插件不能挡住工具瀑布流
3. `tools.guard` 只有返回 `undefined` 是放行；`null` 会被当成拒绝理由 → `Error: null`
4. `package.json` 不能有 BOM（PowerShell `Set-Content -Encoding UTF8` 会写）
5. Cordis 服务要 `inject` 声明，或 `ctx.get('name')` 取；拿不到要等（webServer 晚于插件起来）
6. patch 里别写 `disabled: false`（会盖掉界面停用）
7. 插件**零依赖**；配置只走 profile 的 `cordis.patch.yml`
8. 同一路由注册两次会激活失败（已容错）
9. 客户端插件：`dsh.client` + `./client` + `window.__ModuleLoader__.load({id})`
10. 会话标题只能改**活着的**会话；工作区标题按路径匹配（id 是内部的）
11. 升级 DSH 后先看 `dsh.profile.bundles` 里有没有 `@local/fishbowl`（没有则插件根本不加载）
12. 每个阶段：测试全绿 → commit → tag → push → 更新进度列表

## 8. 当前状态

- 阶段：M0–M16 完成；记忆已抽成 `packages/memory`，插件通过 `packages/plugin/memory/` 接入
- 标签：`m0` … `m16.1`（记忆模块的提交在其后）
- 待办：
  1. 真机验证记忆模块（合并记忆、检索、注入）
  2. 叫醒消息去祈使句 + 冷落事件化
  3. 成长瓶颈制（g 降级为环境参数）
  4. QQ 桥真机联调、B 站通道
- 用户待办：联调完删 DeepSeek key、轮换 GitHub PAT

## 9. 回滚

```powershell
git log --oneline
git checkout m15      # 记忆抽取之前
git checkout m16.1    # 语音/注入修正之后
```
