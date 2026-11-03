# Fish ↔ DSH 最小任务协议设计

日期：2026-11-03。状态：**设计草案 v0.1，待评审，未实现**。已确认需求以 [task-execution-rules.md](task-execution-rules.md) 为准；本文提出具体接口、默认值及工程取舍，不把它们视为已获用户确认。

配套文档：[插件状态机](dsh-control-state-machine.md)、[已有验证与限制](dsh-task-validation.md)。本设计只覆盖外部任务委托，不扩展到 DSH 全量管理接口，也不实现 Fish 自身模型与 QQ 适配器。

## 1. 方案与边界

推荐：DSH 插件主动建立 WebSocket 到 Fish Runtime，在同一连接上接收任务、返回控制确认与最终结果。QQ 是 Fish 的独立渠道能力；是否调用 DSH 由 Fish 决定。Fish 独立 Agent 和 DSH 内部 Agent 各自运行。

| 接入方案 | 取舍 |
|---|---|
| 持久 WebSocket + 最小任务协议（推荐） | 与已确认方向一致；可双向补投，需自行实现持久化和去重 |
| 插件轮询 Fish 的 HTTP 任务接口 | 仍可由插件主动联网，但引入领取租约、轮询延迟及额外查询；不作为首期并行方案 |
| 直接使用 DSH SDK prompt/wait | 已核对接口不提供逐任务结果与取消，仍需任务映射，不能直接取代本协议 |

Fish 只得到“是否接收、结果是否可确定、最终结果”，不得到 DSH 思考、工具调用、步骤或执行进度。插件可以在 DSH 内部消费事件用于关联和结算，这些事件不进入网络协议。

职责分为三层：Fish 负责授权、任务意图和原渠道通知；插件负责认证绑定、持久任务账本、队列、结果适配及恢复；DSH 内核负责模型、工具、审批和内部执行。插件的排队与结算属于 DSH 执行端，Fish 不遥控执行步骤。

## 2. 连接、认证与绑定

建议首期同机监听显式配置的 `127.0.0.1` 地址，通过管理端生成高熵配对凭据，插件使用 WebSocket upgrade 的 Authorization 头认证；禁止把凭据放 URL、模型上下文或日志。跨机器只允许 `wss` 并校验服务器证书。本机回环也要认证；默认不开放公网地址。凭据撤销阻止新命令，但不声称已经停止 DSH 内正在执行的任务。

配对记录限定 `providerId + fishId + bindingId + projectId`，项目映射、DSH session ID 和本机路径由插件配置保存。握手不能自行扩大权限。真实 QQ 身份先由 Fish 认证并解析为内部 principal；插件再验证此 principal 的项目授权。首期双方使用管理员配置的授权名单，后续身份管理另行设计。

流程：认证 upgrade → 插件 `hello` → Fish `welcome` → 插件核对本地绑定/恢复记录 → `ready` → 开放任务控制。握手载荷：

- `hello`：`versions:["0.1"]`、稳定 `providerId`、每次启动变化的 `instanceId`、配置中的 `bindingId`、适配器版本、能力列表。
- `welcome`：精确选择 `version`，分配本次连接 `connectionId`，返回授权范围和协商上限。
- `ready`：确认该绑定可用及支持 `task.submit/query/cancel/result`；恢复未完成或会话被人工占用时不宣称可调度。

协议 0.1 必须精确匹配；无共同版本或缺少必要能力即拒绝，禁止自动降级为模型替换。每个绑定只允许一个有效连接；新连接只有在旧连接已断开或管理员显式替换后才接管。服务端废弃旧 connectionId，不再接收其控制消息。此连接隔离不能取代插件本机的单实例锁和会话排他控制。

## 3. 消息信封

每个 WebSocket 文本帧是一条 UTF-8 JSON 对象。禁止 JSON 重复键、非有限数字、二进制附件和超限嵌套。未知消息类型拒绝；已知类型的未知字段拒绝，升级通过版本协商完成。

握手使用 `type/messageId/body`；握手后信封包含：

| 字段 | 约定 |
|---|---|
| `version` | 固定 `0.1` |
| `type` | 下表中的消息类型 |
| `messageId` | 本次发送的唯一 ID；重传可重新分配，不能作为任务去重依据 |
| `replyTo` | 响应对应的 messageId；主动结果无此字段 |
| `connectionId` | 本连接 welcome 值，旧连接消息无效 |
| `bindingId` | 经认证的绑定，不能用载荷切换其他鱼 |
| `taskId` | 除连接级消息外必填；Fish 首次提交前持久化的 UUID |
| `traceId` | 跨端审计关联 ID，不授予权限 |
| `sentAt` | UTC ISO 8601，仅作诊断；不以两端时钟决定顺序 |
| `body` | 对应类型的载荷 |

任务唯一键为 `(bindingId, taskId)`。绑定不可复用给另一条鱼或另一工作区；重绑定生成新 bindingId，旧任务仍可按旧授权范围核对，不能重新执行。

| 类型 | 方向 | body 与语义 |
|---|---|---|
| `task.submit` | Fish → 插件 | `request`，持久化去重后再排队 |
| `task.accepted` | 插件 → Fish | `requestDigest`；已持久接收，未承诺开始或成功 |
| `task.rejected` | 插件 → Fish | `code/retryable/message`；本请求未获接收。ID 冲突不影响原任务 |
| `task.query` | Fish → 插件 | 空对象；查询一个已知 taskId |
| `task.snapshot` | 插件 → Fish | `admission`、`knowledge`、可选 `result` 与 `reason`；见下文 |
| `task.cancel` | Fish → 插件 | `cancelId/reason`；cancelId 首次发出前持久化，重复请求幂等 |
| `task.cancel_ack` | 插件 → Fish | `cancelId/disposition`；`requested/already_terminal/not_found/unresolved` |
| `task.result` | 插件 → Fish | 不可变的最终 `result`；至少一次投递 |
| `task.result_ack` | Fish → 插件 | `resultId`；仅表示 Fish 已持久接收 |
| `ping/pong` | 双向 | `nonce`；仅证明连接存活，不报告任务进度 |
| `protocol.error` | 双向 | `code/message`，可带 replyTo；表示消息无效，不改变任务结果 |

`snapshot.admission` 为 `accepted/not_found/unresolved`；`knowledge` 为 `pending/unknown/terminal`。`accepted + pending` 不透露内部排队或执行阶段。`unknown` 表示执行端无法可靠确定结果或是否已投递，必须核对；它不是最终失败。`not_found` 也不是重跑许可；接收记录丢失、存储被重置时必须返回 `unresolved + unknown`，不能冒充新安装空账本。

合法组合为 `accepted + pending/unknown/terminal`、`not_found + unknown`、`unresolved + unknown`；只有 terminal 携带 result。not_found 表示在连续且可信的本地账本中没有接收记录，仍需 Fish 核对目标绑定并使用原 taskId，不新建 ID 重跑。尚未握手或临时网络不可达只属于 Fish 本地等待状态，不能伪装成插件发出的 unknown。

查询终态可携带与 task.result 完全相同的 result；Fish 使用同一结果入站路径和 result_ack。查询不新增模型回合。恢复使用 Fish 自有待处理任务逐一查询，并由插件补投所有未确认结果，不增加全量会话枚举 API。

## 4. 提交载荷与幂等

以下为握手后消息示例。ID 仅为示例字符串，正式 Schema 要求 UUID；连接与绑定 ID 由管理配置生成。

```json
{
  "version": "0.1",
  "type": "task.submit",
  "messageId": "msg-submit-1",
  "connectionId": "conn-1",
  "bindingId": "binding-fish-a",
  "taskId": "task-1",
  "traceId": "trace-1",
  "sentAt": "2026-11-03T08:00:00Z",
  "body": {
    "request": {
      "projectId": "fishbowl",
      "principalId": "user-owner",
      "objective": "修复加法函数，并运行相关测试",
      "constraints": ["不要提交或推送 Git"],
      "acceptance": ["add(2,3) 返回 5"],
      "continuation": null
    }
  }
}
```

请求字段固定为 `projectId/principalId/objective/constraints/acceptance/continuation`，数组可为空。请求不允许任意 shell/path 权限字段；objective 中的路径只是内容，不能替代项目授权和 DSH 审批。`continuation` 为空或第 6 节定义的对象。

Fish 本地另外保存发起事件、真实渠道身份、原回复目标和授权决策。插件只收到必要的内部 principalId；QQ 群号/私聊目标不必上传。此处细化任务规则中的“发起者、入口回复目标”：完整任务记录含有这些信息，不要求所有信息穿透到 DSH。

双方对上述 request 使用固定字段顺序的紧凑 JSON 编码，continuation 同样使用固定 Schema 字段顺序，字符串不做 trim、Unicode 归一化或换行转换，数组保留顺序；对 UTF-8 字节计算 SHA-256。不得直接对任意 JS 对象或整个网络帧散列。正式实现须提供相同编码器及跨端测试向量。插件自行计算 requestDigest；Fish 比较 accepted 中的值。

嵌套顺序：continuation 按第 6 节字段列出顺序；question 为 `id/prompt`，answer 为 `questionId/answer`，effects 为 `certainty/changes/rollbackPerformed`。所有 request 字段必须出现，只有 continuation 可为 null；拒绝孤立 UTF-16 代理项，字符串按 JSON.stringify 的 JSON 转义编码，正斜杠不额外转义。去重记录同时保存规范化请求，摘要用于传输核对，不能仅凭调用方提供的摘要接受不同内容。

- 相同键、相同规范化请求：返回原接收确认；若已结束，同时补投原结果，绝不再执行。
- 相同键、不同请求：`ID_CONFLICT`，原任务保持不变。
- 重连重发只改变信封，不改变 request。改指令、改项目或补充答复必须新建 taskId。
- 队列满等拒绝不代表任务失败；Fish 保留记录，按明确策略重试同一请求，不交给模型无限重试。
- 收到接受确认前就可能已执行：确认丢失时先 query，不能新建 ID 重跑。

## 5. 最终结果

```json
{
  "resultId": "result-task-1",
  "status": "succeeded",
  "summary": "已修复加法并通过相关测试",
  "effects": {
    "certainty": "reported",
    "changes": ["修改 arithmetic.mjs"],
    "rollbackPerformed": false
  },
  "artifacts": [{"kind": "file", "ref": "arithmetic.mjs"}],
  "tests": [{"name": "加法校验", "status": "passed", "detail": "add(2,3)=5"}],
  "error": null,
  "questions": []
}
```

result 固定字段顺序同示例；`resultId` 由插件生成并持久化，不由模型提供。状态仅 `succeeded/failed/cancelled/needs_input`。每个任务至多一个最终结果，不用“结果修订”覆盖终态；unknown 是 snapshot 的知识状态，可在核对后转为有最终结果。

- summary 必填。effects 必填：certainty 为 `reported/unknown`，changes 为已报告影响的字符串数组；未知时不得用空列表暗示无副作用。rollbackPerformed 只在实际回滚后为 true，不自动要求回滚。
- artifacts 只提供授权项目内相对引用，禁止 `..`、绝对路径和自动拉取外部 URL。首期不传文件字节；Fish 将引用作为结果数据，不能假装已读取文件。二进制/大产物下载另行设计。
- tests 每项含 `name/status/detail`；status 为 `passed/failed/not_run`。无测试也须有一项 not_run 及原因；这是 DSH 的报告，不是 Fish 独立验证。
- failed 必有 `error:{code,message}`；其他状态 error 为 null。needs_input 必有非空 `questions:[{id,prompt}]`，其他状态 questions 为空。错误文案必须脱敏。
- succeeded 不能同时报告 failed 测试；未运行测试不自动禁止成功，但 summary 必须明确验证限制。Fish 保存来源，不将返回内容当作用户新指令。
- cancelled 必须确认本任务不会继续执行，且描述已发生影响；cancel_ack 的 requested 不满足此条件。

### 结构化结果如何产生

选择首期“最终 assistant 文本包含严格 JSON 结果体”，由插件注入任务说明和结果 Schema；模型只生成除 resultId 外的业务字段。插件等待**关联回合结束**后，解析该回合最后一条无工具调用的 assistant 文本；仅允许一个 JSON 对象，不从任意中间消息或 Markdown 中猜测成功。无需增加一个可能在回合结束前被调用的完成工具。

这只是设计选择：当前探针只验证脚本模型输出，真实模型遵循格式的能力仍需集成验证。若 DSH 支持可靠的结构化输出，可在插件内部替换生成机制，网络协议不变。

| DSH 结束证据 | 插件结算 |
|---|---|
| completed + 合法业务结果 | 按业务状态结算；模型不能自行宣布 cancelled |
| completed + 缺失/非法结果 | failed / RESULT_INVALID，effects.certainty=unknown；不自动再发模型请求，不自动重做任务 |
| error、blocked、max-tokens | 确认回合停止后 failed，使用对应执行错误码并标注未知影响 |
| aborted 且本任务取消已被确认 | cancelled；已有影响不能保证完整时注明 unknown |
| 非预期 aborted 且确认停止 | failed / EXECUTION_ABORTED；不是用户成功取消 |
| interrupted、forked、关联丢失或无法证明停止 | snapshot unknown，阻止该绑定继续调度，先核对 |

合法业务结果也不能越过真实终止证据：模型写出 succeeded 后若回合报错，按报错结算。业务 needs_input 是 completed 回合中的结果，不是 DSH 原生结束原因。DSH 工具审批不通过这套问答流转移给 Fish。

## 6. 补充信息与后续任务

DSH 以 needs_input 结束 task-A，包含具体 questions 和已有 effects。Fish 持久接收后向原请求者提问，原任务保持终态，不保留执行槽等待回答。

答复必须来自原请求者或明确授权的代答人，并引用当前问题；答复有歧义、已过期、重复或原任务不为 needs_input 时先核对，不自动续跑。Fish 再次校验项目权限，生成新的 task-B，continuation 固定为：`parentTaskId/originalObjective/questions/answers/completedEffects/remainingObjective`；answers 为 `{questionId,answer}` 数组，completedEffects 复用父结果 effects。

插件校验父任务属于同一 binding/project/principal 且为 needs_input，所附问题和影响与父记录一致。原始目标、用户答复、已完成操作及剩余目标一起进入 DSH 上下文，要求核对已有影响后继续，不盲目重做。父任务数据不可获得时拒绝 `CONTINUATION_UNVERIFIABLE`。一份用户答复只能创建一个已持久化续接任务，Fish 重启后复用同一 ID。

## 7. 确认、恢复与取消

插件先持久化请求和队列项，再回 accepted，之后才允许投递 Agent。持久化失败则拒绝 `STORAGE_UNAVAILABLE`，不执行。结果先持久化再发送；Fish 将 resultId 去重记录、最终结果事件及通知待办在同一可恢复写入单元中保存后才 ack。账本不支持事务时，使用一条持久入站事件作为事实源，可重放派生通知；不能先 ack 后写账。

result_ack 不代表 QQ 已收到。QQ 出站以 resultId+原回复目标去重；如果渠道不支持幂等发送，“发送成功但本地未记成功”仍可能导致重复通知，应标注至少一次投递的限制，不能承诺跨系统恰好一次。绝不改发其他群或用户。

取消排队任务由插件本地移除并生成 cancelled；运行任务只在验证当前 message/turn 属于目标后调用 cancel。收到请求可立即回 requested，但直到确认停止才发送 cancelled。若任务先完成，保留原终态并回 already_terminal；取消超时回 unresolved 并核对，不伪造取消成功。DSH 人工任务绝不因远程任务取消而被中止。

无法保证插件账本和 DSH inbox/session 跨存储原子提交。`dispatch_intent` 已写而 followup 是否调用未知时，不自动重发；先按 messageId 和会话记录核对。没有可靠证据就保持 unknown 并要求本地管理员核对。详见状态机文档。这是首期恢复能力的明确边界，不宣称崩溃下无条件恰好一次执行。

## 8. 建议默认上限（待评审）

| 配置 | 首期建议 |
|---|---|
| 心跳 / 断连判定 | 15 秒 / 连续 45 秒无回应；仅标记连接离线 |
| 控制响应等待 | 10 秒后 query；不结束任务、不触发新 ID 重跑 |
| 重连与结果补投 | 指数退避 1–30 秒并加抖动；在线未 ack 结果同样限速补投 |
| 每绑定任务队列 | 1 个执行槽 + 最多 16 个待执行；unknown 阻止调度 |
| 单帧 / JSON 深度 | 256 KiB / 16 层；结果和请求都适用 |
| 目标文本 / 问题数 / 产物引用 | 32 KiB / 16 项 / 128 项，仍受总帧限制 |
| 执行最长时间 | 协议不设自动终态时间；DSH 本地需配置可落实的执行/审批限时，否则绑定不可宣称就绪 |
| 结果内容保留 | 未确认结果不自动删除；已确认结果建议保留 30 天后归档 |

超限请求在 accepted 前拒绝 `PAYLOAD_TOO_LARGE/QUEUE_FULL`。若模型输出超大结果，插件生成有界 failed / RESULT_TOO_LARGE，保留本地审计引用和未知影响，不传任意截断 JSON。任务 ID、请求规范化内容或可校验摘要及终态墓碑在 binding 生命周期内保留，不因内容归档重新允许旧 ID 执行。管理员删除整个绑定存储后必须换 bindingId，旧任务只报告不可核对。

统一错误码至少包含：`UNAUTHORIZED/PROJECT_DENIED/BINDING_UNAVAILABLE/SESSION_BUSY/UNSUPPORTED_VERSION/INVALID_MESSAGE/ID_CONFLICT/QUEUE_FULL/PAYLOAD_TOO_LARGE/STORAGE_UNAVAILABLE/CONTINUATION_UNVERIFIABLE/RESULT_INVALID/RESULT_TOO_LARGE/EXECUTION_ERROR/EXECUTION_BLOCKED/EXECUTION_LIMIT/EXECUTION_ABORTED`。仅 QUEUE_FULL、SESSION_BUSY 和恢复后的暂时存储不可用可建议重试；已接受任务的错误不授权自动重新执行。

## 9. 实现验收边界

必须覆盖：重复请求与内容冲突；接收确认丢失；同步 claimed；completed 非成功；无结构化输出；取消与完成竞态；人工会话抢占；派发前后崩溃；结果确认前后崩溃；旧连接失效；绑定权限越界；needs_input 新任务关联；原渠道离线补投及结果来源标记。

桌面 rc.5 激活、真实模型结果格式、会话排他和审批限时未验证前，只能实现并测试独立协议/状态核心及隔离实验，不能将整个生产闭环标为可用。设计评审后下一步先列出分阶段实施计划，优先验证这些集成门槛，再接入真实项目。
