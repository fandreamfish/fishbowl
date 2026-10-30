# fishbowl · DSH 插件（M1）

把经历压成倾向：会话事件 → 异步评价 → 情绪/偏置 → 注入 + 工具约束。

## 安装（开发期：本地目录链接）

在 DSH 的插件管理器里用「安装本地目录」指向本仓库的 `packages/plugin`（本地目录安装是链接 checkout，改代码走 HMR）。
或者用命令行（profile 名按你的实际）：

```bash
dsh plugin --profile desktop add <本仓库>/packages/plugin
```

> M1 不做打包发布；`exports` 只指向 `./index.js`，核心代码以相对路径引用仓库里的 `src/core/*.ts`
> （Node 24 原生类型剥离，无构建步骤）。**打包安装前必须把核心一起打进 files**。

## 配置

在 profile 的 `cordis.patch.yml` 里给插件行加 `config:`：

```yaml
- insert:
    - id: fishbowl
      name: '@local/fishbowl'
      config:
        stateDir: 'C:/Users/你/.fishbowl/creatures'   # 默认 ~/.fishbowl/creatures
        timezone: 'Asia/Shanghai'
        model: 'deepseek-chat'
        appraiser:
          kind: 'deepseek'            # scripted（离线关键词版，默认）| deepseek（API 结构化输出）
          apiKey: 'sk-...'            # 你的 DeepSeek API key
          baseUrl: 'https://api.deepseek.com'
        control: false                # A/B 对照组时改 true
        verifyTools: ['bash', 'pwsh']
        verifyThreshold: 0.6
        refuseTools: []               # 例：['bash']——低拒绝门槛时 guard 拒绝
        refuseThreshold: 0.25
        sessionFilter: []             # 空 = 管理所有会话
```

## 行为

- 每个**新会话**第一次出现时创建**一个个体**：气质随机（不可指定），状态在 `stateDir/<creatureId>/`
- 每轮 `turn/end` 后异步评价 → 情绪 → 6 个旋钮 → `agent.inject()` 进下一轮
- 验证门槛高（≥0.6）时，`verifyTools` 里的工具先 `ask` 再执行
- 拒绝门槛低（≤0.25）时，`refuseTools` 里的工具被 guard 拒绝
- 每轮把 `{appraisal, affect, bias}` 追加进 `stateDir/trace.ndjson`（A/B 分析用）

## A/B 验收（M1 的生死线）

1. **对照组**：`control: true`，跑一遍固定剧本（3–6 轮 × 若干场景）
2. **实验组**：`control: false`（且换一个 `stateDir`，让个体重新出生），同一剧本再跑一遍
3. 比较两组的 `trace.ndjson` + 会话表现：
   - 自动指标：工具调用次数、ask 次数、回复长度、追问次数
   - 盲评：两版回复混排，判断是"行为变了"还是"只是措辞变了"
4. **通过标准**：≥3 个场景出现可观察的行为差异，且盲评认可
5. 不通过：回 `src/core/engine.ts` 调权重，**不加新机制**

## 联调前必须复核（cordis_inspect_query）

- `session/event` 监听签名 `(session, event)` 与 `turn/end` 等事件类型名
- `agent.inject()` 的 content 形状（必须带 `role: 'user'` 与唯一 `id`，否则会话日志里的 `user/message` 缺字段，API 请求会 422 失败）
- `ctx.agents.get(id)` / `list()` 的键（当前按 `session.id` 尝试，失败再扫描）
- `tools/pre-execute` 返回 `{ kind: 'ask' }` 的确切字段
- `ctx.tools.guard()` 回调入参与返回值语义

## 已知限制（M1 有意不做）

巩固、议程、主动联系、UI、多个体管理、封存、云部署。评价失败一律回退中性，绝不阻塞主对话。
