# 产品文档目录

本目录存放 `@meing/dsh-task-plugin` 自身的产品文档。

约定：

- 文件名使用 ASCII 短横线短名，例如 `task-orchestrator.md`。
- 每份文档在被用户确认前处于草稿状态；确认后由插件提交 git 并进入任务拆解。
- 文档确认后不要手工重命名，任务与数据库通过文件名（slug）反向关联。

与运行时产物的区别：插件在被使用的**项目仓库**中生成产品文档到该仓库的 `docs/products/`；
本目录是插件包自身的文档位置，同时也是插件运行时生成文档的格式示例。

当前文档：

- [system-features.md](./system-features.md)：系统功能全景，描述当前系统的全部功能，需求确认后立即更新；当前 13 项能力均标记为 `已实现`。
- [task-orchestrator.md](./task-orchestrator.md)：任务自动分解与排期执行插件的需求产品文档。
