# @meing/dsh-task-plugin

DeepSeek Harness 的任务自动分解与排期执行插件。当前仅建立工程骨架，**不包含任何实现代码**。

规划中的能力：以产品角色澄清需求并在**目标项目**生成 `docs/products/*.md`，经用户确认后提交 git；再由独立模型会话判断复杂度并把任务与依赖关系落库（`docs/tasks/*.md` + SQLite）；后台调度器按依赖关系串行取出可执行任务，调用 DSH 执行并在完成后为每个任务独立提交。

- 产品与功能定义：[docs/products/system-features.md](./docs/products/system-features.md)（系统功能全景）、[docs/products/task-orchestrator.md](./docs/products/task-orchestrator.md)（需求产品文档）
- 任务文档目录约定：[docs/tasks/README.md](./docs/tasks/README.md)
- 完整产品文档：[PRD.md](./PRD.md)

## 目录结构

```text
task/
├── cordis.patch.yml     # DSH 插件挂载声明
├── docs/                # 插件自有文档
│   ├── products/        # 系统功能全景 + 各需求产品文档
│   └── tasks/           # 任务描述文档的格式与命名约定
├── PRD.md               # 产品需求文档摘要（完整版见 docs/products）
├── src/
│   ├── index.ts         # Host 插件入口（骨架）
│   └── client/index.ts  # Web 悬浮通知面板入口（骨架）
└── tsdown.config.ts     # Host + Client 双入口构建配置
```

## 开发

```sh
pnpm install
pnpm --filter @meing/dsh-task-plugin test
pnpm --filter @meing/dsh-task-plugin build
```

实现顺序见产品文档第 11 节里程碑（M1 仓储与领域模型 → M7 发布）。
