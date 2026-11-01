# @fishbowl/affect

纯函数核心：评价（appraisal）→ 情绪（affect）→ 六维决策偏置（bias），以及成长率与遗忘窗口。

- 零 IO、零依赖：不读文件、不调模型、不知道宿主。
- 情绪是事件的纯投影：同样的账本 + 同样的时刻，结果一定相同。
- 半衰期可配：`HalfLives` 由调用方传入（默认 3/2/2 天）。

```ts
import { applyAppraisal, applyElapse, toBias } from '@fishbowl/affect'

applyAppraisal(affect, appraisal, temperament)
applyElapse(affect, seconds, temperament, { guilt: 3, longing: 2, negative: 2 })
const bias = toBias(affect, temperament)
```

宿主与存储都不在这里：`@fishbowl/being` 负责账本与个体，`@fishbowl/memory` 负责记忆。
