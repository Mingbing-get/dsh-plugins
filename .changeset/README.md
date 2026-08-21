# Changesets

每次面向用户发布的插件变更，都在提交前运行 `pnpm changeset`，选择受影响的包和语义化版本级别。

发布时先运行 `pnpm version-packages`，检查并提交生成的版本与 CHANGELOG，然后运行 `pnpm release` 发布到 npm。
