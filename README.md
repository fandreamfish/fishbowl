# fishbowl

一个"把经历压成倾向"的系统：**记忆是原料，人格是轨迹，情绪是决策的实时偏置。**

不是角色扮演，也不是配置出来的 NPC：她的人格来自账本里发生过的事，情绪会真实改变她的行为，遗忘是功能。

**当前版本：0.14.9** · Node ≥ 22.18 · 零运行时依赖 · DSH 插件 + QQ 桥

---

## 现在能做什么

| 能力 | 状态 |
|---|---|
| 事件溯源账本（append-only，可搬迁、可重放） | ✅ |
| 情绪 → 6 个决策旋钮（话量/拒绝/验证/风险/披露/耐心） | ✅ |
| 记忆：每轮双总结 → 合并记忆 → 召回 → 预算注入 | ✅ |
| 一个体 = 一个目录 + 一个会话（房间），终身唯一 | ✅ |
| 每条鱼一份完整 `config.json`，设置页改完即存 | ✅ |
| 许可 / 审计：申请—同意—签发—消费—违约记录 | ✅ |
| B 站：只读浏览、热评/弹幕、评论与回复、风控冷却 | ✅ |
| 清醒节律、主动联系配额、自处配额 | ✅ |
| 日记 / 小纸条 / 家目录（`home/`，她可随意改） | ✅ |
| 导出 / 导入（幂等，跨机器搬家） | ✅ |
| QQ 桥（OneBot v11，同一份账本） | ✅ |
| DSH 设置页：状态 / 住处 / 作息 / 上网 / 人设 / 记忆 | ✅ |

---

## 结构

```
packages/
  affect/          情绪与偏置的纯数学（无 IO）：评价→情绪→旋钮、成长率、遗忘
  memory/          记忆：账本投影、总结、合并、召回、渲染、单写者锁
  being/           个体：Creature facade、住处、许可、日记、家目录、请求
  schedule/        清醒窗口、联系闸门、自处配额
  journal/         日记 / 小纸条 / 请求的提示词与解析
  voice/           语气规则（按关系原型）
  bilibili/        B 站：只读浏览、评论、风控、登录态
  app/             应用层：配置、绑定、回合收集、唤醒循环、约束、状态拼装
  adapter-dsh/     DSH 适配器：宿主能力、HTTP 路由、视图
  plugin/          DSH 插件：组合根、四个工具、设置页前端
  bridge-qq/       QQ 桥（独立进程，共享账本）
legacy/            M0 验收与 Python 原型（已冻结）
scripts/           分层/接口/导入检查、冒烟、会话排查
docs/              设计、审计、发布说明、学习文档
```

依赖方向由 `scripts/dev/check-layers.mjs` 强制；跨包只能 import 对方 `src/index.*`（`check-interfaces.mjs`）。

---

## 数据长什么样

```
~/.fishbowl/
  creatures/<uuid>/
    meta.json         身份（名字、出生、时区、模型、temperament、住处）
    log.ndjson        唯一真相：append-only 事件流
    projection.json   情绪投影缓存（可删，重算一致）
    config.json       这条鱼的全部设置（12 个顶层键）
    home/             她可以随便改的文件夹
      diary/          一天一个 .md
      notes/          一条一个 .md
  config.json         插件级配置快照（不含 apiKey）
  scopes.json         工作区/会话索引
  trace.ndjson        运行诊断
```

事件契约见 [docs/EVENTS.md](docs/EVENTS.md)：只加字段不改语义，改语义必须新事件 + 追加式迁移。

---

## 快速开始

```sh
npm run test:all                    # 分层 + 接口 + 模块加载 + 七套测试
node scripts/smoke/m7-apply-smoke.ts # 插件激活冒烟（假宿主）
```

安装到 DSH、配置模型与 B 站登录、QQ 桥联调，见：

- [PLUGIN.md](PLUGIN.md) — DSH 集成接口清单
- [docs/DEPLOY.md](docs/DEPLOY.md) — 部署
- [docs/CHANNELS.md](docs/CHANNELS.md) — 通道
- [docs/INTEGRATION.md](docs/INTEGRATION.md) — 联调清单

B 站登录只落本机 `~/.fishbowl/bili-auth.json`（0600）；建议用小号。设置页可分别填 `SESSDATA` / `bili_jct` / `DedeUserID`，也可以整段粘贴。

---

## 测试与检查

```sh
npm run test:all
# = check-layers + check-interfaces + check-imports + 七套测试
```

七套：memory、plugin（unit/browse/bili）、bridge-qq、其余随包测试；另有激活冒烟。
测试不依赖任何 npm 包（零依赖，无需 install）。

CI 做法见 [docs/CI.md](docs/CI.md)（当前 PAT 无 `workflow` scope，未提交 workflow 文件）。

---

## 文档

| 文件 | 内容 |
|---|---|
| **[docs/LEARNING.md](docs/LEARNING.md)** | **从零读懂整个项目（逐包、精确到行）** |
| [DESIGN.md](DESIGN.md) | 完整设计：公理、状态模型、评价器、情绪、记忆、成长率、关系原型 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 分层与边界 |
| [docs/MEMORY.md](docs/MEMORY.md) | 记忆系统 |
| [docs/BROWSE.md](docs/BROWSE.md) | 上网与说话 |
| [docs/HOST.md](docs/HOST.md) | 宿主适配层契约 |
| [docs/STATE.md](docs/STATE.md) | 当前状态与常用命令 |
| [docs/EVENTS.md](docs/EVENTS.md) | 事件契约与迁移规则 |
| [docs/SETTINGS-CONFIG-AUDIT.md](docs/SETTINGS-CONFIG-AUDIT.md) | 设置项 ↔ 配置文件对照 |
| [docs/VERSIONING.md](docs/VERSIONING.md) | 版本规范与发布流程 |
| [ROADMAP.md](ROADMAP.md) | 阶段与验收 |
| [docs/releases/](docs/releases/) | 每个版本的改动与原因 |

---

## 两条可搬迁性不变量

1. 复制 `creatures/<id>/` 目录（含 `home/`）→ 重开 → 行为一致
2. 删除投影缓存 → 全量重放 → 结果一致

情绪是纯投影；记忆结论落盘进账本。**重算情绪，不重算结论。**

---

## 已知边界

- **许可不是安全围墙**：她在工具层受许可/审计约束，但有 shell 与完全文件权限；绕过工具直接调 B 站接口在理论上可行。要做硬边界，需要拿掉工具或上沙箱。
- 设置页仍有少数"有键无 UI"的项：`wake.idleSkip`、`contact.burst/requireReason`、`selfTime.idleWaitMs`、`diary.enabled`、`affect.longingDays`、`browse.grantDetect/rankingTids/historyDays/avoid.upMids`。
- `@` 的 uid/昵称属于 `bili-auth.json`，不在单鱼 config.json。
- 有旧进程并发写同一本账时可能出现读-改-写覆盖；单写者锁只告警，不强制。
