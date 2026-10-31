# @local/fishbowl-memory

fishbowl 的记忆模块：只追加的账本、合并记忆、检索与渲染。纯 TypeScript，不认识任何宿主。

- 设计：`docs/MEMORY.md`
- 宿主接线：`packages/plugin/memory/`（进程内实例、`memory_search` 工具、设置页）

```ts
import { Memory } from '@local/fishbowl-memory'

const mem = new Memory({ dir: 'creatures/<id>' })
mem.observe({ note: 转录, appraisal, salience, affect })  // 一轮落盘，零 LLM
await mem.tick({ llm })                                    // 两份总结 + 到点整理
const { text } = mem.render({ affect, bias, name })        // 注入块
mem.search(query)                                          // BM25（同步）
await mem.searchHybrid(query)                              // 配了向量才融合
```

```powershell
node packages/memory/test/unit.test.ts
```
