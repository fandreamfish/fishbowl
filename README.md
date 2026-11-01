# fishbowl

一个"把经历压成倾向"的系统：记忆是原料，人格是轨迹，情绪是决策的实时偏置。

## 文档

| 文件 | 内容 |
|---|---|
| [DESIGN.md](DESIGN.md) | 完整设计（公理、状态模型、评价器、情绪、记忆、成长率、关系原型、部署与搬迁） |
| [docs/MEMORY.md](docs/MEMORY.md) | 记忆系统设计（账本、合并记忆、检索、注入） |
| [docs/BROWSE.md](docs/BROWSE.md) | 上网与说话设计（B 站、自处、许可、登录/@/评论/回复、风控与设置） |
| [docs/HOST.md](docs/HOST.md) | 宿主适配层契约（怎么把"鱼"接到别的宿主上） |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 分层分析：核心 / 能力 / 工具 / 可抽取模块与重构路线 |
| [docs/RELEASE-0.1.0.md](docs/RELEASE-0.1.0.md) | 0.1.0 发布说明：包清单、能力、不变量与留白 |
| [docs/VERSIONING.md](docs/VERSIONING.md) | 版本规范：patch/minor 怎么涨、提交/打标/推送流程 |
| [docs/AUDIT-0.1.5.md](docs/AUDIT-0.1.5.md) | 0.1.5 结构体检：耦合、上帝模块、优化顺序 |
| [docs/AUDIT-0.3.2.md](docs/AUDIT-0.3.2.md) | 0.3.2 结构体检：剩余耦合、测试盲区、P0–P4 |
| [docs/AUDIT-0.3.7.md](docs/AUDIT-0.3.7.md) | 0.3.7 结构体检：偏重文件、语义门面、死导出 |
| [PLUGIN.md](PLUGIN.md) | DSH 集成接口清单 |
| [ROADMAP.md](ROADMAP.md) | 阶段与验收标准 |
| [docs/STATE.md](docs/STATE.md) | 当前状态、开发要点、常用命令 |
| [docs/DEPLOY.md](docs/DEPLOY.md) · [docs/CHANNELS.md](docs/CHANNELS.md) · [docs/INTEGRATION.md](docs/INTEGRATION.md) | 部署、通道、联调清单 |

## 结构

```
packages/
  affect/          核心：评价→情绪→偏置、成长率、遗忘（纯函数，零 IO）
  being/           个体：账本、事件溯源、住处、承诺、许可
  memory/          记忆：账本、合并记忆、检索、渲染
  schedule/        清醒节律与主动联系配额
  voice/           声音规则（按关系原型）
  journal/         日记 / 小纸条 / 请求
  bilibili/        B 站只读浏览（窗口、配额、风控、评论闸门、登录态）
  app/             应用服务：按鱼配置、评价器、LLM 端口、注入渲染、绑定、改名、回合/唤醒用例
  adapter-dsh/     DSH 适配器：事件、注入、唤醒、工具、设置页 HTTP
  plugin/          DSH 插件入口与前端（index.js / client.js / 工具薄封装）
  bridge-qq/       QQ 桥（OneBot v11，独立进程）
creatures/<id>/    一条鱼一个目录：账本、情绪投影、她自己的配置（config.json）、她的家（home/）
src/               demo / 测试 / 兼容层（旧路径 re-export，下一版删除）
scripts/           CLI、dev 工具（分层检查 / 迁移 / 调试）、smoke
prototype/         Python 原型（已冻结）
```

## 运行

```sh
node src/test.ts                        # 内核验收
node packages/memory/test/unit.test.ts  # 记忆模块
node packages/plugin/test/unit.test.ts  # 插件
node packages/plugin/test/browse.test.ts # 上网（纯逻辑 + 假 fetch）
node packages/plugin/test/bili.test.ts   # 登录 / 评论 / 回复（假 fetch）
node packages/bridge-qq/test/unit.test.ts
node scripts/smoke/m7-apply-smoke.ts    # 插件激活冒烟（假宿主）
node src/demo.ts                        # 四组剧本演示
```

`npm run test:all` 跑前六套。

要求 Node ≥ 22.18（原生类型剥离，无需构建）。

## 两条可搬迁性不变量

1. 复制 `creatures/<id>/` 目录 → 重开 → 行为一致
2. 删除投影缓存 → 全量重放 → 结果一致

情绪是纯投影；记忆结论落盘进账本。重算情绪，不重算结论。
