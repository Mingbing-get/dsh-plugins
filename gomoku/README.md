# dsh-gomoku-plugin

使用 TypeScript、React 和 tsdown 构建的 DeepSeek Harness 五子棋插件。

模型调用 `gomoku_start` 后，工具保持运行中，Web 界面出现一个无蒙层、可拖动的悬浮棋盘。用户点击落子后，工具才返回坐标和完整棋盘给模型；棋盘保持打开，模型分析后调用 `gomoku_move` 落下自己的一子，该工具再次等待用户落子。新一轮模型落子会自动打开曾被关闭的棋盘；每条五子棋工具记录都提供“显示棋盘”按钮，可恢复当前会话最后一次棋盘并继续等待中的对局。窗口只在胜负/和棋结束时自动关闭，也可由用户手动关闭。

## 开发与构建

本项目的开发依赖通过相对 `link:` 路径连接到同一台机器上的 `/Users/mingbing/apps/test/deepseek-harness`，确保类型和运行时接口与目标 checkout 完全一致。

```sh
cd /Users/mingbing/apps/ai-project/dsh-plugins
pnpm install
pnpm --filter @meing/dsh-gomoku-plugin test
pnpm --filter @meing/dsh-gomoku-plugin build
pnpm --filter @meing/dsh-gomoku-plugin pack:check
```

版本与 npm 发布由仓库根目录的 Changesets 管理：提交功能改动时运行 `pnpm changeset`，发布时运行 `pnpm version-packages`，审阅并提交版本改动后执行 `pnpm release`。

构建会从 `src/index.ts` 生成 Node 侧的 `lib/index.js`，从 `src/client/index.ts` 和 React 组件生成 Harness Web 模块格式的 `lib/client.js`。`prepack` 会在 npm 打 tarball 前自动重新构建；发布的 npm 包和本地 `dist/*.tgz` 都可直接安装，无需在 profile 中执行构建脚本。

## 安装

```sh
dsh plugin --profile web add @meing/dsh-gomoku-plugin
dsh web
```

安装后，在 Web 对话里说“我们下五子棋”。

## 工具协议

- `gomoku_start(size?, model_first?, first_move_row?, first_move_column?)`：新建对局。默认 15×15、用户执黑先手；模型先手时可指定第一手，省略则落在中心。工具打开棋盘并等待用户落子。
- `gomoku_move(row, column)`：模型选择并落下一子；如果对局尚未结束，则重新打开棋盘并等待用户下一手。

对局状态保存在当前 Harness 进程内，并以 agent session 对象隔离。重新启动 Harness 后需重新开局。
