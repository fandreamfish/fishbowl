# @local/fishbowl-memory

fishbowl 的记忆模块：只追加的账本、合并记忆、检索与渲染。纯 TypeScript，不认识任何宿主。

- 设计：`docs/MEMORY.md`
- 抽取决策与迁移：`docs/MEMORY-MODULE.md`
- 宿主接线：`packages/plugin/memory/`（进程内实例、工具、设置页）

```ts
import { Memory } from '@local/fishbowl-memory'

const mem = new Memory({ dir: 'creatures/<id>' })
await mem.observe(turn)        // 记录一轮
await mem.tick(lookup)         // 整理（合并层）
const text = mem.render(affect, bias)   // 注入文本
const hits = mem.recall(query) // 检索
```

```powershell
node packages/memory/test/unit.test.ts
```
