# DSH 任务执行可行性验证

日期：2026-11-03。结论：已验证安装版 DSH 内核可接收消息、驱动工具、记录最终回合，并提供关联与取消基础；尚未验证桌面 Control Plugin 与 Fish 的完整任务协议。

## 环境与版本

- CLI：`D:/environment/nodejs/node_global/node_modules/@deepseek-ai/dsh`，0.2.1-rc.2；Node 22.21.0。
- 桌面：`S:/DeepSeek Harness/resources/app.asar` 中 dsh/package.json 和 Agent/Loop/Session 包均为 0.2.1-rc.5。
- 桌面源码从 ASAR 只读提取到临时目录并校验记录中的 SHA-256；未修改安装包、用户 profile 或凭据。
- 本轮发现 dsh 命令及上述安装均可访问，取代此前“环境无 DSH”调查结论。未启动桌面应用，未调用付费模型或读取密钥。

## 可重复探针

`scripts/dev/probe-dsh-task.mjs` 是实验性可行性探针，不是正式适配器。用真实安装的 Cordis、DSH Agent、AgentLoop、LLM 和 Tool Runtime，搭配确定性脚本模型，在独立临时目录工作；不加载用户配置，不联网，不写真实项目。

```powershell
node scripts/dev/probe-dsh-task.mjs --dsh-node-modules 'D:/environment/nodejs/node_global/node_modules/@deepseek-ai/dsh/node_modules'
```

2026-11-03 实际执行退出码 0，五个场景断言通过：

| 场景 | 实际验证 | 证明范围 |
|---|---|---|
| 代码工具往返 | 脚本模型发出工具调用；DSH 调度工具，将临时 arithmetic.mjs 的减法修成加法，实际加载并断言 add(2,3)=5；第二次模型请求给出最终文本 | 真 DSH 工具循环、临时文件变更和执行校验；不证明真实模型自主编码能力 |
| 模型失败 | 脚本适配器抛出预设错误，turn/end 为 error | 失败可从回合事件识别 |
| 取消 | 在适配器运行时调用 cancel，信号中止后 turn/end 为 aborted | 真实内核取消路径；未验证真实工具中途取消 |
| 补充信息结果 | 脚本模型返回 needs_input 业务结果，DSH 原生 turn/end 为 completed | 业务结果需独立解释；不是 DSH 原生 needs_input 终态或真实用户问答功能 |
| 排队与关联 | 连续 followup 两个带唯一 ID 的消息，claimed 分别关联 turn 1/2，两个回合均结束 | 可按消息 ID → turn → 最终消息建立关联；非持久任务去重验证 |

探针首轮遗漏了同步触发的首条 claimed 通知：因为回调用尚未赋值的返回 ID 过滤。改为提前在 Agent 作用域订阅后全部通过。正式插件必须在消息投递前持久化 ID 和注册监听，不能等 followup 返回后再建立关联。

## 核实的接口与适配方向

CLI 本地包 README 和类型声明，以及桌面 rc.5 lib/index.js 提供以下证据：

- `agent.followup(message)` 接收有 ID 的 user-role 消息并唤醒驱动；返回值是 void，不是任务完成或持久接收承诺。
- `agent/inbox/claimed` 提供 message 与 turn，插件可用它关联投入的任务与执行回合。恢复仍需本地持久任务映射与账本核对。
- `session/event` 的 assistant/message 带 turn/step；同回合可能有多条模型消息和工具调用，不可把第一条 assistant 消息当作任务结束。
- `turn/end.reason` 区分 completed、error、aborted、blocked、max-tokens 以及恢复中断等情况。completed 是回合完成，不自动等于业务任务成功。
- `whenIdle()` 观察整 Agent 静默，不对应单个消息的结算，不能单独作为 task.completed。
- `cancel(cause, {keepInbox:true})` 中止当前活动并保留其他队列消息；必须先核对目标任务确实正在执行，不能取消错误任务。尚未开始的任务应定位并移除对应 inbox 消息，不能无差别 cancel。
- SDK JSON-RPC 文档提供 session/prompt、session/wait，但明确没有逐 prompt 结果和 prompt-cancel。可作参考，不能不加任务映射就等价于所需协议。

建议正式插件内部订阅 DSH 事件，以任务 ID → message ID → session/turn 关联执行；监听仅用于适配器识别最终输出，不转发给 Fish。委托任务与人工输入共享执行会话时必须处理排他、排队和人工插入，避免把无关回复匹配给任务。

## 尚未通过的集成门槛

1. 桌面 rc.5 插件实际激活与目标会话投递；CLI rc.2 运行结果不能替代 rc.5 真机验证。
2. 真实模型自主修改代码、DSH 原有工具和审批路径。
3. Fish ↔ 插件 WebSocket、认证授权、项目映射、接受确认与结果确认。
4. 持久任务去重、重连、进程重启、消息已执行但确认丢失的恢复。
5. 结构化业务结果输出与校验：成功/失败/取消/needs_input，错误输出降级为未知或明确协议错误，不靠自然语言猜成功。
6. Fish 异步队列、QQ 通知和记忆审计完整组合用例。

下一步可以据此设计最小协议和适配器任务状态机；不能宣称当前任务执行闭环已经全部验收。

后续设计已记录在 [task-protocol-design.md](task-protocol-design.md) 和 [dsh-control-state-machine.md](dsh-control-state-machine.md)，当前为待评审草案，未增加本页所述运行验证范围。
