# DSH Plugins

这是一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件集合仓库。每个插件位于独立目录中；发布时会构建为可直接由 DSH 安装的 `.tgz` 文件，并作为 GitHub Release 附件提供。

使用者无需 clone 本仓库或安装插件的开发依赖：下载所需版本的 `.tgz` 后，执行 `dsh plugin add <文件路径>` 即可。

## 插件目录

### 五子棋（`gomoku`）

提供一个可交互的五子棋工具和 Web 悬浮棋盘。

| 版本 | 发布说明与下载 |
| --- | --- |
<!-- latest-release:gomoku -->
| `0.3.0` | [查看 Release](https://github.com/Mingbing-get/dsh-plugins/releases/tag/v0.3.0) |

直接安装最新包：

```sh
<!-- latest-install:gomoku -->
dsh plugin add https://github.com/Mingbing-get/dsh-plugins/releases/download/v0.3.0/dsh-gomoku-plugin-0.3.0.tgz
```

### CodeGraph（`codegraph`）

按当前会话工作区建立并查询代码图谱。

| 版本 | 发布说明与下载 |
| --- | --- |
<!-- latest-release:codegraph -->
| `0.1.0` | [查看 Release](https://github.com/Mingbing-get/dsh-plugins/releases/tag/codegraph-v0.1.0) |

直接安装最新包：

```sh
<!-- latest-install:codegraph -->
dsh plugin add https://github.com/Mingbing-get/dsh-plugins/releases/download/codegraph-v0.1.0/dsh-codegraph-plugin-0.1.0.tgz
```

## 所有版本

前往 [GitHub Releases](https://github.com/Mingbing-get/dsh-plugins/releases) 查看所有已发布的插件包。
