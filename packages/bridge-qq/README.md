# fishbowl QQ 桥接（M3.3）

同一个体，第二张嘴。桥与 DSH 插件共享同一份 `creatures/` 状态，靠**单写者锁**互斥。

## 部署

1. 装一个 OneBot 实现（NapCatQQ 等），配置正向 WebSocket 连接 + HTTP API（如 `ws://127.0.0.1:3001` + `http://127.0.0.1:3000`）
2. 复制 `config.example.json` → 你自己的配置，填 API key、QQ 号
3. 运行：

```sh
node packages/bridge-qq/index.js --config <你的配置.json>
```

## 行为

- **私聊**：intimate 场合——她带着完整记忆和你说话（同 DSH 会话）
- **群聊**：public 场合——只在被 @ 时回应，**注入零记忆**（私聊里的事不会在群里说）
- 锁文件 `creatures/.qq-bridge.lock`：DSH 插件与桥同时写会拒绝第二个启动者

## 风险（重要）

- 非官方协议（NapCat 等）有**封号与掉线风险**，只在小号上试
- 官方 QQ 开放平台更稳，但对**主动私聊**有限制——先查清当前策略再决定用哪条路
- 群聊回复频率目前没有独立配额（走 public 场合），需要时在群里少用

## 未做（后续）

- 主动联系（她的清醒循环在 DSH 插件里；桥只被动回复 + 投递队列可扩展）
- B 站评论通道：需要议程层（"她想说的"来源）——见 docs/CHANNELS.md
