# dsh-codegraph-plugin

DeepSeek Harness 的 TypeScript CodeGraph 插件。它在每个会话的 `header.cwd` 中先检测源码；非代码目录不会创建 `.codegraph/`。代码目录会使用插件私有、固定为 `@colbymchenry/codegraph@1.5.0` 的 CLI 初始化或同步索引，启动每 Workspace 一个 stdio MCP server，并在模型请求前注入有界、明确标记为不可信的相关代码上下文。

默认关闭 CodeGraph 遥测、更新检查和脱离插件生命周期的 daemon。插件卸载时会关闭其 MCP 子进程，但保留工作区 `.codegraph/` 索引。

## 开发

```sh
cd codegraph
pnpm install
pnpm test
pnpm build
```

安装到 Harness：

```sh
pnpm dsh plugin --profile web add /absolute/path/to/dsh-plugins/codegraph
```

工具：`codegraph_explore`、`codegraph_node`、`codegraph_status` 和 `codegraph_sync`。它们始终从当前 session 的 workspace 路由，不能传入任意路径。
