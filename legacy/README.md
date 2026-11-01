# legacy

这些是早期原型与 M0 验收，**已冻结**，不再维护：

- `m0-src/`：M0 的数值验收脚本（对应 Python 原型的算法核对）。现在由 `packages/*/test` 覆盖。
- `prototype/`：最初的 Python 原型。保留它是为了对照 DESIGN.md 里的数学推导。

不要在这里加新功能；跑测试用 `npm run test:all`。
