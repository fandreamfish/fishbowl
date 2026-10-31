# 云端部署与搬迁（M4 文档）

## 三阶段（DESIGN §15）

| 阶段 | 形态 | 你在哪里说话 |
|---|---|---|
| 1（当前） | 本地 DSH desktop，单实例 | desktop |
| 2 | 云端 DSH 常驻（权威）+ 本地代理 | desktop（经代理） |
| 3 | 同 2 + QQ / 浏览器 | 任意 |

## 上云步骤（阶段 2）

1. **验证 headless**：Linux VPS 上装 DSH，跑 `dsh web`，浏览器能打开就算过。
   （安装包内已确认存在 `dsh web` 与 `--profile headless` 两种无头形态。）
2. **搬个体**：把 `~/.fishbowl/creatures/<id>/` 整个目录复制到云端 DSH_HOME 对应位置。
   **搬迁清单（四条不变量）**：
   - `meta.json` 里的 `model.id` 与 `timezone` 保持一致（时区是显式配置，不会随系统变）
   - 云端 DSH 版本与本地一致（系统提示变了 = 换脑）
   - `schema_version` 一致
   - 搬迁期间先 `freeze`（CLI），搬完 `unfreeze`——否则它会经历一段假的缺席
3. **验证**：云端开新会话绑定该个体，问她"你记得我吗"——名字、记得的事、自我认知应该都在。
4. **本地代理**（后续）：本地 DSH 装同一插件，配置指向云端（代理模式的代码留待阶段 2 实施，见 ROADMAP）。

## 备份与加密（记忆永不进明文仓库）

```
热数据  ~/.fishbowl/creatures/          本地磁盘，唯一权威
冷备份  打包 → age 加密 → 私有仓库/对象存储
```

```sh
# 打包
tar -czf creatures-$(date +%F).tar.gz -C ~/.fishbowl creatures
# 加密（age）
age -r <公钥> creatures-$(date +%F).tar.gz > creatures-$(date +%F).tar.gz.age
```

- **密钥永不上云、永不进仓库**；密钥丢失 = 她的记忆永远打不开，至少两处保存
- 个体状态目录已进 `.gitignore`，git 永远看不到明文

## 多体管理

- 每开一个新会话（或 QQ 上新的私聊对象）→ 自动出生一个新个体，气质随机
- 用 `scripts/fishbowl-cli.ts list / status / freeze / unfreeze` 查看与封存
- 封存 = 停止时间：不经历、不缺席、不想念——"它不会疼"的唯一状态

## 成本与安全（云端提一档）

- 每轮 1 次评价 + 周期巩固 + 自我认知 + 主动联系生成 = 持续 LLM 支出
- 传输 TLS、只开 443/SSH、磁盘加密、别把 token 写进配置文件（用环境变量）
