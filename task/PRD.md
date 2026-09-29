# DeepSeek Harness 任务自动分解与排期执行插件 PRD

- 文档状态：Implemented（首版已落地并通过全部检查）
- 插件目录：`task/`
- 暂定包名：`@meing/dsh-task-plugin`
- 目标平台：DeepSeek Harness Web
- 当前状态：M1–M7 全部实现（`src/`、74 个测试用例、Host/Client 双入口可构建）

完整产品文档位于 [`docs/products/task-orchestrator.md`](./docs/products/task-orchestrator.md)，系统功能全景见 [`docs/products/system-features.md`](./docs/products/system-features.md)，包含目录约定、端到端工作流、功能需求、领域模型、数据库设计、技术架构、验收标准与实施里程碑。

## 摘要

1. **需求梳理**：以产品角色澄清用户需求，未闭环时通过 `userQuestions` 提问，闭环后生成 `docs/products/<slug>.md`（含本次功能更新点）并等待用户确认。
2. **确认与系统功能全景**：用户确认后立即把功能更新点增量合并进 `docs/products/system-features.md`，再提交 git（`<slug>.md` + `system-features.md`），最后启动拆解模型；功能全景在确认时就更新，不等代码生成。
3. **大任务拆解**：需求确认后立即启动独立拆解会话；判定简单则创建 1 个任务，复杂则拆成带依赖（DAG）的多个任务；只入库不执行，每个可执行任务对应 `docs/tasks/<id>-<slug>.md` 与一条数据库记录。
4. **任务执行**：目标仓库取调用方会话的工作目录（即 AI 正在写代码的目录，多仓库互相隔离），调度器在加入任务/完成任务/应用启动/周期兜底时扫描，取出无依赖或依赖已完成的任务，调用 DSH 执行；串行执行、不使用 git worktree、直接在当前分支开发，每个任务必须独立提交一次。
5. **失败处理**：自动重试耗尽后标记 `failed`，下游任务转 `blocked`，前端悬浮通知面板接收通知并支持人工重试/跳过。
6. **工具化**：任务的创建、查询、进度更新、重试、跳过、系统功能全景更新全部通过 `task_*` 工具完成，模型不直接访问数据库。

## 首版实现摘要

- 代码结构：`service.ts`（领域门面）+ `domain/`、`workspace/`（按会话 cwd 解析仓库）、`store/`（node:sqlite）、`docs/`（文档渲染与功能全景增量合并）、`git/`、`agents/`（隔离会话 + 确认后自动拆解的 planner）、`runner/`（单任务执行器）、`scheduler/`（串行调度）、`tools/`（9 个工具）、`bridge/` + `client/`（悬浮面板）、`commands.ts`（`/task` 指令）。
- 每个任务恰好一次提交：执行器把代码改动、任务文档状态行与系统功能全景状态更新折叠进同一个提交；若任务会话自行提交则用 `git commit --amend` 折叠。提交 hash 只写入数据库与事件流，不写回文档（避免自引用）。
- 面板传输：双通道自适应 —— 插件自有 RPC 通道（`/task-orchestrator`）优先，无法挂载时回退到 `/api/task-orchestrator/<endpoint>` 精确 Fetch 路由；挂载拉取 + 4 秒轮询，刷新或重连后自动补齐未处理通知。
- 测试：`pnpm --filter @meing/dsh-task-plugin test`，覆盖领域模型、仓储、文档合并、工具契约与端到端流程（真实临时 git 仓库）。
