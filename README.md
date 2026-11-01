# fishbowl

一个"把经历压成倾向"的系统：记忆是原料，人格是轨迹，情绪是决策的实时偏置。

## 文档

| 文件 | 内容 |
|---|---|
| [DESIGN.md](DESIGN.md) | 完整设计（公理、状态模型、评价器、情绪、记忆、成长率、关系原型、部署与搬迁） |
| [docs/MEMORY.md](docs/MEMORY.md) | 记忆系统设计（账本、合并记忆、检索、注入） |
| [docs/BROWSE.md](docs/BROWSE.md) | 上网与说话设计（B 站、自处、许可、登录/@/评论/回复、风控与设置） |
| [docs/HOST.md](docs/HOST.md) | 宿主适配层契约（怎么把"鱼"接到别的宿主上） |
| [docs/BROWSE.md](docs/BROWSE.md) | 上网（B 站只读浏览 / 评论闸门 / 自处节律） |
| [PLUGIN.md](PLUGIN.md) | DSH 集成接口清单 |
| [ROADMAP.md](ROADMAP.md) | 阶段与验收标准 |
| [docs/STATE.md](docs/STATE.md) | 当前状态、开发要点、常用命令 |
| [docs/DEPLOY.md](docs/DEPLOY.md) · [docs/CHANNELS.md](docs/CHANNELS.md) · [docs/INTEGRATION.md](docs/INTEGRATION.md) | 部署、通道、联调清单 |

## 结构

```
src/core/          认知内核：评价→情绪→偏置、事件日志、成长率、住处、节律（纯逻辑，零宿主）
                   另有 browse.ts：上网的时段/配额/过滤/排序/素材渲染（纯逻辑）
src/scenarios.ts   脚本化评价（测试/离线用）
packages/memory/   记忆模块：只追加账本、合并记忆、检索、渲染（纯 TS，可独立使用）
creatures/<id>/   一条鱼一个目录：账本、情绪投影、她自己的配置（config.json）
packages/plugin/   DSH 插件
  host/dsh.js       唯一碰 DSH 的地方（事件流/注入/唤醒/工具钩子/标题/枚举/HTTP 路由）
  memory/           记忆模块的进程内实例与 memory_search 工具
  lib/              回合管道、注入渲染、绑定、声音、约束、设置页后端
  lib/browse/       上网与说话：B 站客户端、素材、seen、登录、评论/回复、工具、风控
  client.js         设置页前端
packages/bridge-qq/ QQ 桥（OneBot v11，独立进程，共享同一份个体状态）
scripts/            CLI 与实验工具；dev/ 调试脚本；smoke/ 冒烟测试
prototype/          Python 原型（已冻结，8/8 通过）
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
