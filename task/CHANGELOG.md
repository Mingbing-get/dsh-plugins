# @meing/dsh-task-plugin

## 0.1.0

### Minor Changes

- 首版实现：需求梳理（`task_requirement_draft` 澄清循环 + 人工确认门禁）、系统功能全景增量合并（`task_system_features_read` / `task_system_features_apply`）、任务拆解（确认后自动启动独立拆解会话调用 `task_plan_create`，含 DAG 校验与幂等保护）、`node:sqlite` 权威存储（事务、乐观锁、事件、通知、调度租约）、串行调度器与单任务执行器（隔离 DSH 会话、验收校验、每任务恰好一次提交、中断回收、退避重试与阻塞传播）、Web 悬浮介入面板（`shell.overlay`）与 `/task` 指令。产品文档见 `docs/products/task-orchestrator.md`，系统功能全景见 `docs/products/system-features.md`。
- 悬浮面板端点改为双通道自适应：优先插件自有 RPC 通道（`connection.rpc.handle`），在 `rpc.handle` 无法注册物理路由的 DSH 构建（0.1.5-rc.1）上回退到 `connection.fetch.register` 注册的 `/api/task-orchestrator/<endpoint>` 精确 Fetch 路由；两条通道都在 `/api` 鉴权栅栏之后。
- 面板与 `/task` 指令改为**子插件**装载，各自声明所需的 service（`connection` + `webServer`、`commands`），核心（工具 / 调度器）不再因为缺少某个能力而整体装载失败。
- 目标仓库改为按**调用方会话的工作目录**（`session.header.cwd`）解析：同一进程可同时服务多个仓库，每个仓库拥有独立的数据库、文档树、调度器与任务编号空间，并按需惰性创建与缓存；`workspaceRoot` 降级为无会话调用时的回退值。会话创建时会接管对应工作区，保证重启后的中断回收对再次活跃的工作区自动生效。
- 运行状态（SQLite 数据库）移出工作区：默认落在插件侧状态目录 `$DSH_HOME/storages/task-orchestrator/`（新增 `stateDir` 配置，必须是绝对路径或 `~` 开头），并**每个工作区一个库**，文件名由仓库绝对路径派生（`<目录名>-<sha256 前 12 位>.sqlite`），显式配置 `databaseFile` 时才共用单库；只有文档产物（`docs/products/`、`docs/tasks/`）仍写在目标仓库里。工作区不再出现 `.dsh/`，`git status` 保持干净，也不会因为插件自己的运行文件而卡住 `requireCleanWorktree` 预检。
- 编排过程现在**在前端可见**：插件发起的会话（任务执行、需求拆解）按普通会话创建（不再带 `origin: 'subagent'`），以仓库根目录为 `cwd` 并挂到该目录所属工作区（目录尚无工作区时按前端的做法自动创建），标题固定为 `任务 T1 · <任务标题>`（重试追加`（第 N 次尝试）`）与 `拆解需求 <slug>`。因此它们和手动发起的对话一样出现在 Web 前端的会话列表与目标仓库分组里，点开即可实时旁观模型消息、工具调用与进度上报，结束后仍可回看；显式标题同时避免了每个编排会话再触发一次标题模型调用。写标题与挂工作区都是尽力而为（服务缺失或失败只记日志，不影响编排），新增 `exposeOrchestratorSessions`（默认 `true`）可一次性退回隐藏的 subagent 会话。
- 编排会话现在**按 Agent 预设组合工具**：Web 面把模型可见的工具行全部禁用在宿主 plane（`tool-fs`、`tool-bash`、`tool-todo`、`tool-web`、`tool-subagent`… 见 `dsh-web-app/cordis.patch.yml`），改由每个会话挂载的预设提供，宿主 plane 里只剩插件自己的 `task_*`。插件此前直接 `agents.create` 而不组合预设，导致执行/拆解会话只能看到 9 个 `task_*` 工具：读不了任务文档、跑不了验证命令、改不了代码，任务必然失败。现在按 `session.create`（前端新建对话）的做法组合：创建前解析预设 id（默认取预设名单的默认预设）写入 header 的 `agentPreset`，并在 `setup` 里 `agentPresets.mount(agentCtx, id)`；预设不存在/损坏时创建回滚，不留下无法干活的会话。新增 `agentPreset` 配置可改用别的预设；没有预设名单的部署（TUI/headless）行为不变，只是显式配置会被警告一次后忽略。实测同一 Web profile 内：不挂预设的会话解析出 9 个 `task_*`，挂预设的解析出 36 个（含 `read`/`write`/`edit`/`bash`/`glob`/`grep`/`todo_write`/`skill`/`subagent`/`web_search`…）。
- 实现期澄清的两处设计：任务提交 hash 只入库不写回文档（避免自引用）；面板传输使用插件 RPC 快照 + 4 秒轮询而非服务端事件推送（不依赖 apiproxy 内部广播扩展点）。
