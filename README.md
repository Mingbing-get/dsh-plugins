# DSH Plugins

这是一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件集合。插件作为公开 npm 包发布，并由 [Changesets](https://github.com/changesets/changesets) 统一管理版本、变更日志和发布。

## 安装

```sh
dsh plugin --profile web add @meing/dsh-gomoku-plugin
dsh plugin --profile web add @meing/dsh-codegraph-plugin
```

如需可复现安装，请指定版本：

```sh
dsh plugin --profile web add @meing/dsh-gomoku-plugin@0.3.0
dsh plugin --profile web add @meing/dsh-codegraph-plugin@0.1.0
```

## 开发

```sh
pnpm install
pnpm test
pnpm build
pnpm pack:check
```

两个插件仍可在各自目录中单独构建和测试。

## 发布

每次需要对外发布的改动，在提交前创建一个 changeset：

```sh
pnpm changeset
```

发布者汇总已有 changeset，审阅并提交生成的版本号与 CHANGELOG：

```sh
pnpm version-packages
git add .
git commit -m "chore: version packages"
pnpm release
git push --follow-tags
```

首次发布前须先执行 `npm login`，并确认 `@meing` 是当前账户或组织可发布的 scope。`pnpm release` 会先构建，再通过 Changesets 发布尚未存在的版本到 npm；它不是上传本地 `dist/*.tgz` 文件。

`gomoku/scripts/release.mjs` 和 `codegraph/scripts/release.mjs` 保留为 GitHub Release 附件的兼容流程，可分别运行 `pnpm release:github`；它们不属于常规 npm 发布流程。
