# fishbowl

一个"把经历压成倾向"的系统：记忆是原料，人格是轨迹，情绪是决策的实时偏置。

| 文件 | 内容 |
|---|---|
| [DESIGN.md](DESIGN.md) | 完整设计（公理、状态模型、评价器、情绪、记忆三层、成长率、关系原型、部署与搬迁） |
| [PLUGIN.md](PLUGIN.md) | DSH 集成接口清单（按本机安装的 0.2.1-rc.3 核实） |
| [prototype/](prototype) | Python 原型：验证"情绪确实改变了行为"（8/8 通过，已冻结） |
| [src/](src) | M0：TypeScript 内核移植（纯逻辑、零依赖、Node ≥22.18 直接跑 .ts） |
| [packages/plugin/](packages/plugin) | M1：DSH 插件（事件收集、异步评价、状态注入、工具约束） |

## 运行

```sh
node src/test.ts                       # 内核验收：数值与 Python 原型一致 + 可搬迁性验证
node packages/plugin/test/unit.test.ts # 插件单元测试
node src/demo.ts                       # 四组剧本演示（输出对齐 Python 原型）
```

或者双击 `run-test.cmd` / `run-demo.cmd`（自动找 node，找不到用 DSH 自带解释器）。

要求 Node ≥ 22.18（原生类型剥离，无需构建步骤）。类型检查可选：`tsc --noEmit`。

## 结构

```
src/
  core/
    types.ts       气质 / 评价 / 情绪 / 偏置 / 事件日志类型
    engine.ts      评价 → 情绪 → 偏置（纯函数，数值=原型校准版）
    creature.ts    个体：状态 = f(事件日志, 时间)，投影可重算
    store.ts       creatures/<id>/ 目录：meta + log.ndjson + projection.json
    scheduler.ts   清醒节律（时区显式）
    contact.ts     主动联系限流（取交集）
  scenarios.ts     脚本化评价（M1 起由异步 LLM 评价替换）
  test.ts / demo.ts
```

## 两个可搬迁性验证（M0 已内置）

1. 复制 `creatures/<id>/` 目录 → 重开 → 行为一致
2. 删除 `projection.json` → 全量重放 → 结果一致

情绪是纯投影，LLM 的结论（M2 的巩固产物）会落盘进日志——重算情绪、不重算结论。
