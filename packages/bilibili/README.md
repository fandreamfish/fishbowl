# @fishbowl/bilibili

B 站只读浏览的纯能力：活动窗口、配额计划、风控节奏、浏览记录、评论闸门。

- 不含 DSH 工具（那是适配层）
- 不含登录态落盘（`lib/browse/auth.js` 属于宿主侧）

对外：`browsePlan` / `inWindow` / `browseDayKey` / `createClient` / `noteRisk` 等。
