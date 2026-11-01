# 事件约定

账本是 append-only 的 `creatures/<id>/log.ndjson`，每行一个 JSON 事件。
**它同时是她的经历、情绪的重放源、记忆的原料。** 破坏兼容的代价不是重装插件，是读坏一本账。

## 信封（每个事件都必须有）

```json
{ "t": "turn", "id": "uuid", "ts": 1793520000000, ... }
```

- `t`：事件类型，字符串
- `id`：事件 id，uuid（同一本账内不重复）
- `ts`：毫秒时间戳，写事件那一刻

其余字段由类型自己定义。**没有信封字段的事件视为坏行**：写入方负责保证，读取方跳过。

## 现有类型（`packages/affect/src/types.ts`）

| t | 用途 | 关键字段 |
|---|---|---|
| `episode` | 旧版轮次（正在被 `turn` 取代） | appraisal / note |
| `turn` | 一轮对话 + 记忆原料 | note / appraisal / injected |
| `absence` | 缺席时长 | wakingHours |
| `contact` | 重逢 | relief |
| `repair` | 被原谅 | amount |
| `semantic` / `procedure` / `self` | 记忆条目（旧结构，已迁到 memory 包） | claim / confidence / status |
| `identity` | 接受名字 | name |
| `commitment` / `commitment-resolved` | 承诺与兑现/违诺 | text / status |
| `activity` | 一起做的事 | title / status |
| `reinforce` | 记忆强化 | ref |
| `outreach` | 主动联系配额 | reason |
| `wake` | 醒来（联系 / 自处） | mode / reason |
| `grant` | 长期允许（"你没事可以刷 B 站"） | topic / allowed |
| `diary` / `note` | 日记 / 小纸条 | date / text |
| `request` / `request-answered` | 请求与回答 | action / target / answer |
| `permit` / `permit-used` | 一次性许可与消费 | ref / uses / ttlMs |
| `breach` | 没等同意就做了 | action / target |
| `freeze` / `unfreeze` | 封存 | — |

types 里的联合类型是唯一权威；本文只做索引，不复制字段细节。

## 规则

### 1. 只加字段，不改含义

同类型内加可选字段 → 兼容。旧读者不认识的字段会忽略。

```diff
- { t: 'request'; id: string; ts: number; text: string }
+ { t: 'request'; id: string; ts: number; text: string; action?: string }
```

### 2. 改语义 = 新类型 + 迁移

不要改写旧字段的含义（比如把 `answer: 'yes' | 'no'` 改成布尔）。正确做法：

1. 加新类型（例如 `request-answered-v2`）
2. 写一个一次性迁移脚本，把旧事件**追加**成新事件（不删旧行）
3. 读取方同时认旧、新；旧字段只读

### 3. 不允许原地修改或删除历史

- 不重写 `log.ndjson` 的旧行
- 不因为“写错了”删事件；用反向事件修正（例如 `commitment-resolved`）
- 快照（`projection.json` / `snapshot.json`）只是缓存，删了必须能从账本重算

### 4. 未知类型 = 跳过，不报错

`buildView`、`summarizeEvent` 对不认识的 `t` 默认返回空 / 跳过。新类型可以在旧进程里安全存在，只是不显示。

### 5. 读到坏行不能毒死整本账

`Store.readEvents` 与 `Ledger.read` 跳过解析失败的行，继续读后面的。写入端必须保证一行一个完整 JSON。

## 加新事件的检查单

- [ ] 在 `affect/src/types.ts` 的 `CreatureEvent` 联合里加类型（带 `t` / `id` / `ts`）
- [ ] 写入方：`creature.store.appendEvent({ t, id: uid(), ts: Date.now(), ... })`
- [ ] 读取方（如果有投影）：`buildView` 里加分支；未知时不影响其它事件
- [ ] 设置页时间线：`adapter-dsh/src/views.js::summarizeEvent` 加一行可读描述
- [ ] 测试：写入一条 → 重放 → 断言投影
- [ ] 如果新事件参与情绪重放，写清楚它的衰减与叠加规则

## 迁移脚本长什么样

```js
// 只追加，不改旧行
for (const e of creature.store.readEvents()) {
  if (e.t !== 'old-type') continue
  creature.store.appendEvent({
    t: 'new-type', id: uid(), ts: e.ts, ref: e.id, value: e.value,
  })
}
```

跑之前先备份 `creatures/<id>`（整个目录），跑完用 `node scripts/dev/test-all.mjs` 复检。

## 什么时候需要真的归档账本

现在（2026-11）最大一本 253 条事件 / 163 KB，整体 1 MB。**远远不到需要归档的规模。**

触发条件（任一）：

- 单本账 > 50 MB，或事件数 > 20 万
- 启动 / 注入明显变慢（`trace.ndjson` 里 state build 超过 100ms）
- 需要跨年保留但不想让旧事件参与检索

到那时再设计“冷段 + 快照”的方案，并且必须保留按时间读回的能力。
