# @fishbowl/being

个体 = 一个目录 + 一本只追加的账本。

- `store.ts`：`creatures/<id>/` 的读写（meta / log.ndjson / projection.json / outbox.json）
- `creature.ts`：事件重放、`affectNow()`、`longingAt()`、住处、承诺、活动、日记/纸条/请求
- `tenancy.ts`：工作区 / 会话住处的互斥
- `signals.ts`：跨会话的许可与唤醒记录

不变量：账本只追加、投影可删可重算、个体自包含。情绪来自 `@fishbowl/affect`，记忆不在这里（`@fishbowl/memory`）。
