# CI

仓库里的 `package.json` 已经把所有检查串成一条命令：

```sh
npm run test:all
```

`npm run test:all` = 分层检查 + 接口检查 + 模块加载检查 + 七套测试（记忆 / 插件 / 浏览 / B 站 / 桥 / 其余）。
另有激活冒烟：

```sh
node scripts/smoke/m7-apply-smoke.ts
```

## 为什么没有 .github/workflows

当前推送用的 GitHub PAT 没有 `workflow` scope，GitHub 会拒绝任何包含 `.github/workflows/*` 的推送。要在 CI 里跑，二选一：

1. 给 PAT 勾上 `workflow` 权限，然后加上这个文件：

```yaml
name: check
on: [push, pull_request]
jobs:
  test:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm run test:all
      - run: node scripts/smoke/m7-apply-smoke.ts
```

2. 或者用别的账号 / GitHub App 添加这个 workflow。

测试不依赖任何 npm 包（零依赖），所以不需要 install 步骤。
