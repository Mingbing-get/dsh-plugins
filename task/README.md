# @meing/dsh-task-plugin

DeepSeek Harness 的任务自动分解与排期执行插件：**说一句需求，剩下的交给系统**。

以产品角色把需求问清楚 → 生成产品文档并等待用户确认 → 确认后先更新系统功能全景再提交 git → 拆解为有依赖关系的可执行任务并落库 → 后台调度器按依赖关系串行执行、每个任务恰好一次独立提交，直到整批任务完成。

- 系统功能全景：[docs/products/system-features.md](./docs/products/system-features.md)
- 需求产品文档（完整设计）：[docs/products/task-orchestrator.md](./docs/products/task-orchestrator.md)
- 任务文档目录约定：[docs/tasks/README.md](./docs/tasks/README.md)
- 产品需求文档摘要：[PRD.md](./PRD.md)

## 能力

| 能力             | 入口                                                                               |
| ---------------- | ---------------------------------------------------------------------------------- |
| 需求梳理与澄清   | `task_requirement_draft`（`openQuestions` 非空时经 `userQuestions` 向用户提问）    |
| 需求确认与提交   | `task_requirement_confirm`（人工确认 → 功能全景 → 一次提交 → 才允许拆解）          |
| 系统功能全景维护 | `task_system_features_read` / `task_system_features_apply`（只接受增量、先读后写） |
| 任务拆解         | `task_plan_create`（DAG 校验，只入库不执行）                                       |
| 查询与进度       | `task_query`、`task_progress`                                                      |
| 人工介入         | `task_retry`、`task_skip`、Web 悬浮面板、`/task` 指令                              |

状态迁移、文档落盘、git 提交、调度与重试全部由 Host 侧领域逻辑完成（`src/service.ts`），模型只能通过工具写入。

## 目录结构

```text
task/
├── cordis.patch.yml       # DSH 插件挂载声明
├── docs/                  # 插件自有文档（格式示例与设计文档）
│   ├── products/          # 系统功能全景 + 各需求产品文档
│   └── tasks/             # 任务描述文档的格式与命名约定
├── PRD.md                 # 产品需求文档摘要（完整版见 docs/products）
├── src/
│   ├── index.ts           # Host 入口：配置、装配、生命周期
│   ├── service.ts         # 领域门面：需求 / 确认 / 拆解 / 查询 / 进度 / 人工介入
│   ├── commands.ts        # `/task` 会话指令
│   ├── domain/            # 实体、状态机、DAG 校验、slug、配置
│   ├── store/             # node:sqlite 仓储（事务、乐观锁、事件、通知、租约）
│   ├── docs/              # 路径守卫、功能全景增量合并、需求与任务文档渲染
│   ├── git/               # 工作区校验、验证命令、提交与 amend
│   ├── agents/            # 隔离的 DSH 会话、确认后自动拆解的 planner、三类角色提示词
│   ├── workspace/         # 按会话工作目录解析目标仓库（多仓库隔离与缓存）
│   ├── runner/            # 单任务执行器
│   ├── scheduler/         # 串行调度器与中断回收
│   ├── tools/             # 9 个 task_* 工具
│   ├── bridge/            # 悬浮面板端点与双通道自适应
│   ├── shared/            # Host/Client 共用的面板协议常量
│   └── client/            # Web 悬浮通知面板（shell.overlay）
└── tsdown.config.ts       # Host + Client 双入口构建配置
```

## 安装

本插件未发布到 npm，作为本地 bundle 装进 DSH profile（以 `web` profile 为例）：

```sh
# 1. 在插件目录打包（会先构建，产物在 task/dist/）
pnpm --filter @meing/dsh-task-plugin run pack

# 2. 装进 profile；dsh 会自动把它加入 dsh.profile.bundles
dsh plugin --profile web add file:/绝对路径/dsh-plugins/task/dist/meing-dsh-task-plugin-0.1.0.tgz

# 3. 确认它出现在组合后的 profile 树里
dsh --profile web --dump-config | grep -A2 task-orchestrator

# 4. 重启 dsh web 后生效（bundle 列表在启动时读取）
```

升级时重复第 1、2、4 步即可（重新打包会产生新的完整性校验）。

## 配置

| 配置项                  | 默认值                          | 说明                                                |
| ----------------------- | ------------------------------- | --------------------------------------------------- |
| `workspaceRoot`         | `process.cwd()`                 | **回退**：仅当调用不带会话工作目录时使用            |
| `databaseFile`          | `.dsh/task-orchestrator.sqlite` | SQLite 位置（相对每个工作区根目录，建议 gitignore） |
| `docsRoot`              | `docs`                          | 目标项目的文档根目录                                |
| `systemFeaturesFile`    | `system-features.md`            | 系统功能全景固定文件名                              |
| `maxRetries`            | `2`                             | 单任务自动重试次数                                  |
| `retryBackoffMs`        | `[30000, 120000]`               | 重试退避                                            |
| `scanIntervalMs`        | `30000`                         | 周期兜底扫描间隔                                    |
| `maxClarifyRounds`      | `8`                             | 单需求最大提问轮数                                  |
| `requireCleanWorktree`  | `true`                          | 执行前要求 git 工作区干净                           |
| `taskTimeoutMs`         | `1800000`                       | 单任务执行会话超时                                  |
| `commitMessageTemplate` | `feat({id}): {title}`           | 任务提交信息模板                                    |
| `enableScheduler`       | `true`                          | 是否启动周期扫描                                    |

运行数据（`.dsh/`）、文档产物（`docs/products/`、`docs/tasks/`）都落在**目标项目仓库**中，不在插件包内。

## 开发

```sh
pnpm install
pnpm --filter @meing/dsh-task-plugin test     # 74 个用例
pnpm --filter @meing/dsh-task-plugin build
pnpm lint && pnpm format:check && pnpm test && pnpm build
```

测试覆盖状态机与 DAG 校验、SQLite 仓储与乐观锁、系统功能全景增量合并（包含对真实 `system-features.md` 的回环校验）、工具契约、拆解会话（确认后自动启动、幂等、失败降级）、多工作区解析（同一进程按会话 cwd 隔离数据库/文档/任务编号）、真实 cordis 上下文下的插件装载（工具/面板/指令三面的 inject 契约与两种面板传输），以及"澄清 → 确认 → 拆解 → 调度 → 提交 → 失败重试"的端到端流程（在临时 git 仓库中真实提交）。

## 面板传输

悬浮面板的五个端点（`snapshot`/`read`/`dismiss`/`retry`/`skip`）会自适应两种通道，浏览器端先探测一次并记住可用通道，两者都在 `/api` 的鉴权栅栏之后：

1. **插件自有 RPC 通道**（首选）：`ctx.connection.rpc.handle('/task-orchestrator', …)`，物理路由注册在调用方 fiber，因此面板子插件注入 `connection` + `webServer`。
2. **`/api` 精确 Fetch 路由**（回退）：`ctx.connection.fetch.register()` 注册 `/api/task-orchestrator/<endpoint>`。DSH 0.1.5-rc.1 的 `rpc.handle` 把物理路由注册在 connection 插件自身的 context 上，而该 context 读不到 `webServer`，插件通道永远挂不上，所以这一档回退是该版本上唯一可用的传输。

## 目标仓库如何确定

任务改造的仓库 = **调用方会话的工作目录**（`session.header.cwd`，即 AI 正在写代码的目录）。同一进程可以同时服务多个仓库：每个仓库各自拥有 `<root>/.dsh/task-orchestrator.sqlite`、`<root>/docs/products|tasks/`、独立的调度器与任务编号空间（`T1` 在两个仓库里互不影响），并按需惰性创建、缓存复用。

会话创建时插件会接管该工作区，因此重启后"再次活跃的工作区"里的中断任务仍会被自动回收。只有不带会话目录的调用（周期扫描、无会话入口）才回退到 `workspaceRoot`。
