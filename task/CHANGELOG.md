# @meing/dsh-task-plugin

## 0.1.0

### Minor Changes

- 首版实现：需求梳理（`task_requirement_draft` 澄清循环 + 人工确认门禁）、系统功能全景增量合并（`task_system_features_read` / `task_system_features_apply`）、任务拆解（确认后自动启动独立拆解会话调用 `task_plan_create`，含 DAG 校验与幂等保护）、`node:sqlite` 权威存储（事务、乐观锁、事件、通知、调度租约）、串行调度器与单任务执行器（隔离 DSH 会话、验收校验、每任务恰好一次提交、中断回收、退避重试与阻塞传播）、Web 悬浮介入面板（`shell.overlay`）与 `/task` 指令。产品文档见 `docs/products/task-orchestrator.md`，系统功能全景见 `docs/products/system-features.md`。
- 悬浮面板端点改为双通道自适应：优先插件自有 RPC 通道（`connection.rpc.handle`），在 `rpc.handle` 无法注册物理路由的 DSH 构建（0.1.5-rc.1）上回退到 `connection.fetch.register` 注册的 `/api/task-orchestrator/<endpoint>` 精确 Fetch 路由；两条通道都在 `/api` 鉴权栅栏之后。
- 面板与 `/task` 指令改为**子插件**装载，各自声明所需的 service（`connection` + `webServer`、`commands`），核心（工具 / 调度器）不再因为缺少某个能力而整体装载失败。
- 目标仓库改为按**调用方会话的工作目录**（`session.header.cwd`）解析：同一进程可同时服务多个仓库，每个仓库拥有独立的数据库、文档树、调度器与任务编号空间，并按需惰性创建与缓存；`workspaceRoot` 降级为无会话调用时的回退值。会话创建时会接管对应工作区，保证重启后的中断回收对再次活跃的工作区自动生效。
- 运行状态（SQLite 数据库）移出工作区：默认落在插件侧状态目录 `$DSH_HOME/storages/task-orchestrator/`（新增 `stateDir` 配置，必须是绝对路径或 `~` 开头），并**每个工作区一个库**，文件名由仓库绝对路径派生（`<目录名>-<sha256 前 12 位>.sqlite`），显式配置 `databaseFile` 时才共用单库；只有文档产物（`docs/products/`、`docs/tasks/`）仍写在目标仓库里。工作区不再出现 `.dsh/`，`git status` 保持干净，也不会因为插件自己的运行文件而卡住 `requireCleanWorktree` 预检。
- 实现期澄清的两处设计：任务提交 hash 只入库不写回文档（避免自引用）；面板传输使用插件 RPC 快照 + 4 秒轮询而非服务端事件推送（不依赖 apiproxy 内部广播扩展点）。
