# DeepSeek Harness CodeGraph 插件 PRD

- 文档状态：Draft
- 插件目录：`codegraph/`
- 暂定包名：`dsh-codegraph-plugin`
- 目标平台：DeepSeek Harness Web / Headless Host
- 首版集成方式：CodeGraph CLI + stdio MCP，不直接调用 CodeGraph SDK
- 首版目标：插件自带 CodeGraph CLI；仅在识别为代码目录的 Workspace 中初始化或同步索引。CodeGraph 可用时，在按当前问题构建的代码上下文已注入后发起模型请求；不可用时明确降级为不提供 CodeGraph 工具和自动上下文的普通模型请求。

## 1. 背景

CodeGraph 能够在项目本地构建代码知识图谱，为 Agent 提供符号搜索、相关源码上下文、调用关系和变更影响分析。它以项目目录下的 `.codegraph/` 保存索引，并提供 CLI、MCP 和 TypeScript SDK 三种集成面。

DeepSeek Harness 支持多 Workspace、多 Session 和模型工具插件。用户期望安装一次插件后，不再手动安装全局 CodeGraph CLI、不再为每个仓库手动执行 `codegraph init`、不再单独启动 MCP Server，也不需要手动维护文件监听进程。

本插件不直接集成 CodeGraph SDK，而是将经过版本验证的 `@colbymchenry/codegraph` 作为运行依赖，仅使用其 CLI 与官方 MCP 协议。插件负责 Workspace 识别、索引生命周期、子进程管理、MCP 路由、失败降级和 DSH 工具注册。

## 2. 产品目标

### 2.1 核心目标

1. 安装 DSH 插件时自动安装插件私有的 CodeGraph CLI，不要求用户执行全局安装。
2. 在某个 Workspace 第一次发送消息、进入首个模型请求之前：
   - 识别 Session 对应的规范化 Workspace 路径；
   - 检查该 Workspace 是否为 CodeGraph 支持的代码目录；
   - 非代码目录直接跳过 CodeGraph，不创建 `.codegraph/`，正常进入模型请求；
   - 代码目录中检查 CodeGraph CLI 是否可执行；
   - 检查 `.codegraph/` 是否存在且索引是否可用；
   - 首次使用时自动执行 `codegraph init` 并等待索引完整构建；
   - 已有索引时执行必要的状态检查和增量同步；
   - 启动该 Workspace 对应的 stdio MCP Server，并完成 MCP `initialize`、`tools/list` 与探活。
3. 对代码目录优先采用准备屏障：CodeGraph 未完全 Ready 时等待准备完成；准备失败或超时时，记录明确诊断并降级为普通模型请求，不自动注入 CodeGraph 上下文，也不暴露不可用的 CodeGraph 工具。
4. CodeGraph Ready 后，插件必须先使用当前用户问题调用 `codegraph_explore`（或锁定版本中等价的上下文构建能力），将结果作为受信边界标记、长度受限的代码上下文直接注入本次模型输入，再调用模型；不得只等待模型自行决定是否调用 CodeGraph 工具。
5. MCP 启动后由 CodeGraph 自动监听该 Workspace 的文件变化，持续更新索引。
6. 同一 Workspace 的多个 Session 共享一份初始化任务和一个 MCP Runtime，不重复初始化或启动进程。
7. 不同 Workspace 使用彼此隔离的索引、状态和 MCP Runtime。
8. DSH 应用关闭或插件卸载时，关闭全部 MCP transport、子进程、监听器和待执行任务。
9. DSH 重启后复用已有 `.codegraph/`，不重复全量初始化，仅检查、同步并重新建立监听。

### 2.2 成功标准

对于尚未初始化的代码 Workspace A：

1. 用户安装插件后，无需全局安装 `codegraph`。
2. 用户在 Workspace A 第一次发送消息时，插件识别其为代码目录，自动创建 `A/.codegraph/` 并等待首次索引完整构建。
3. 在索引构建、MCP 初始化、工具发现和探活全部完成前，模型供应商暂不收到该请求；若准备最终失败或超时，则以无 CodeGraph 上下文和工具的降级请求继续。
4. Runtime Ready 后，插件以当前用户问题查询 `codegraph_explore`，把返回的相关源码、调用路径和影响摘要直接注入模型上下文，然后才发起模型请求。
5. 插件自动启动 `codegraph serve --mcp --path A`，无需用户打开额外终端。
6. 修改 A 中被支持的源文件后，后续自动上下文查询能够看到更新结果，无需手动执行 `sync`。
7. Workspace A 的第二个 Session 不会再次执行 `init`，并复用 A 的 Runtime。
8. Workspace B 的首次消息会创建独立 Runtime，不读取或写入 A 的索引。
9. DSH 关闭后，由插件直接启动的 CodeGraph MCP 子进程全部退出。
10. 再次启动 DSH 并在 A 中发送消息时，不执行全量 `init`，而是复用索引并恢复监听。
11. 对不含受支持源码的 Workspace C，插件不会执行 `init`、不会创建 `.codegraph/`、不会启动 MCP，且模型请求正常发送。

## 3. 非目标

首版不负责：

1. 直接 import 或调用 `@colbymchenry/codegraph` 的 TypeScript SDK。
2. 修改用户的全局 npm、pnpm、shell PATH、Claude、Cursor、Codex 或其他 Agent 配置。
3. 在用户仅浏览 Workspace 列表、尚未发送消息时提前构建索引。
4. 提供完整的代码关系图可视化、侧边栏图谱浏览器或源码编辑器。
5. 替代编译器、测试、lint、类型检查或普通文件读取工具。
6. 保证 CodeGraph 静态分析能准确解析所有动态分派、反射、运行时代码生成或不受支持的语言。
7. 在网络盘、Windows/WSL 共享目录等 CodeGraph 官方不建议的文件系统上保证 SQLite WAL 的可靠性。
8. 自动升级到未经插件版本验证的 CodeGraph 最新版。
9. 默认在 Workspace 长时间空闲时回收 Runtime；首版 Runtime 持续到 DSH 或插件关闭。
10. 为一个 Session 同时查询多个 Workspace；每次工具调用只允许访问该 Session 的 `header.cwd`。

## 4. 关键术语

### 4.1 Workspace Root

由 `exec.agent.session.header.cwd` 或等价 Agent 生命周期上下文提供，并通过 `realpath` 规范化后的绝对目录。它是索引、MCP 路由和权限边界的唯一可信项目路径。

### 4.2 Workspace Runtime

插件为一个 Workspace Root 维护的进程内状态，包含初始化锁、当前状态、MCP client/transport、子进程、错误诊断和关闭能力。

### 4.3 Code Workspace

规范化 Workspace Root 中至少存在一个 CodeGraph 锁定版本支持、且未被忽略规则排除的源码文件。仅有文档、媒体、生成物、依赖缓存、空目录或普通数据文件不属于代码目录。健康索引报告 `indexedFiles > 0` 时可作为强信号，但过期的 `.codegraph/` 目录本身不能单独证明当前 Workspace 是代码目录。

### 4.4 CodeGraph CLI

由插件依赖安装的 `@colbymchenry/codegraph` CLI。插件必须通过解析本包安装树中的确定路径启动它，不依赖系统 PATH 中的同名命令。

### 4.5 Ready

代码 Workspace 已有完整可用索引，必要同步完成，MCP 初始化、`tools/list` 与一次受控探活成功，且插件可以执行自动上下文构建和 DSH CodeGraph 工具调用。

### 4.6 Skipped

Workspace 被判定为非代码目录。插件不执行 init/sync、不启动 MCP、不注入 CodeGraph 上下文，模型请求不受 CodeGraph 准备屏障影响。

### 4.7 Degraded

代码 Workspace 的 CodeGraph 初始化、同步、MCP 启动或上下文构建失败。插件记录稳定错误码和可操作提示；该次请求降级为普通模型请求，后续请求可重试准备流程。仅 CodeGraph 工具调用本身返回失败。

## 5. 用户故事

### US-1：零手工安装

作为用户，我只安装 DSH CodeGraph 插件，即可获得其验证版本的 CodeGraph CLI，无需执行全局 npm 安装。

### US-2：首次消息自动初始化

作为用户，我在一个新 Workspace 第一次发送消息时，系统自动构建 CodeGraph 索引，不要求我预先运行命令。

### US-3：自动监听代码变化

作为用户，我修改项目代码后，希望 CodeGraph 自动同步，使下一次查询使用最新索引。

### US-4：多会话复用

作为用户，我在同一 Workspace 打开多个会话时，希望它们共享同一个 CodeGraph Runtime，不重复占用资源。

### US-5：多 Workspace 隔离

作为用户，我同时使用多个 Workspace 时，希望每个 Workspace 的索引和 MCP 进程互不混淆。

### US-6：应用关闭自动清理

作为用户，我关闭 DSH 后，不希望插件直接启动的 CodeGraph MCP 子进程继续驻留。

### US-7：代码目录识别

作为用户，我在文档或数据目录中对话时，不希望插件误建 `.codegraph/`；只有 Workspace 确实包含受支持源码时才初始化 CodeGraph。

### US-8：准备完成后才调用模型

作为用户，我希望代码目录中的问题先等待 CodeGraph 完成索引、连接和探活；如果准备失败，本次请求应明确失败，而不是在缺少代码上下文时仍消耗一次模型调用。

### US-9：自动注入问题相关上下文

作为用户，我提交代码问题后，希望插件直接根据该问题构建并注入相关源码上下文，而不是依赖模型先猜测并主动调用 CodeGraph 工具。

## 6. 用户体验与生命周期

### 6.1 首次使用流程

```text
用户在 Workspace 第一次发送消息
  → DSH 确认 Session header.cwd
  → 插件规范化 Workspace Root
  → 检测是否存在 CodeGraph 支持且未被忽略的源码
  → 非代码目录：Runtime 标记 skipped → 直接进入模型请求
  → 代码目录：创建或复用 Workspace Runtime，并建立模型请求准备屏障
  → 定位插件私有 CodeGraph CLI
  → 检查 .codegraph/ 与 codegraph status
  → 无有效索引：执行 codegraph init，并等待命令成功退出与索引健康检查通过
  → 有有效索引：执行必要的 codegraph sync，并等待同步完成
  → 启动 codegraph serve --mcp --path <workspace>
  → MCP initialize + tools/list + 受控探活
  → Runtime 标记 ready
  → 使用当前用户问题调用 codegraph_explore/等价上下文构建能力
  → 将有界 CodeGraph 结果注入本次模型上下文
  → 解除准备屏障，发起首个模型请求
```

代码目录采用优先异步准备屏障，而不是“后台初始化后尽力可用”：Host 暂停模型 dispatch，直到 `init/sync → 索引健康检查 → MCP initialize → tools/list → 探活 → 当前问题上下文构建与注入` 成功，随后带上下文调用模型。任一步失败或超时则结束等待，以无 CodeGraph 上下文及不可用 CodeGraph 工具的普通请求调用模型。等待期间应记录阶段进度，并向 Web 提供可订阅状态；后续可增加更完整的进度 UI。

目录检测必须早于 CLI 定位和任何写操作。非代码目录不进入准备屏障，不因 CodeGraph CLI 缺失而阻塞普通对话。

### 6.2 后续消息

同一代码 Workspace 的后续消息直接复用 Ready Runtime。每次真正调用模型前，仍须以当前用户消息文本重新执行一次经契约测试的自然语言上下文构建工具（优先 `buildContext`/`codegraph_context`，否则 `codegraph_explore`）并注入最新结果；文件变化由 CodeGraph MCP watcher 处理，插件不再创建第二套文件 watcher。若 Runtime 因断连离开 Ready，则该次请求不注入 CodeGraph 上下文或工具，并在后台重试恢复和探活。

非代码 Workspace 复用 `skipped` 判定；当文件系统变化表明新增了受支持源码时，下一条消息重新检测并可升级为代码 Runtime。

### 6.3 DSH 重启

`.codegraph/` 持久保留。DSH 重启后，Workspace Runtime 从内存消失；该 Workspace 下一次发送消息时重新执行状态检查、必要的同步和 MCP 启动，但不得无条件执行全量 `init`。

### 6.4 关闭

Cordis plugin dispose、DSH 正常退出或配置卸载时：

1. 拒绝创建新的 Runtime；
2. 中止仍在等待的准备任务；
3. 关闭 MCP client 和 transport；
4. 等待子进程在宽限期内退出；
5. 超过宽限期后终止插件直接拥有的子进程；
6. 清空 Runtime Map；
7. 不删除 `.codegraph/`。

### 6.5 取消与共享准备

用户取消请求、Session 关闭或客户端断开时，只取消该请求对 prepare/context-build 的等待，不取消仍被其他 Session 等待的同 Workspace 共享 prepare 任务。若没有任何等待者且 Runtime 尚未 Ready，插件可取消该准备任务。DSH/plugin 关闭时才取消该 Workspace 的全部任务和子进程。取消发生在 provider dispatch 前时不得发起 provider 调用；发生在 dispatch 后时遵循 DSH 既有的流式取消机制。

## 7. 功能需求

### FR-1：依赖安装与 CLI 定位

1. `@colbymchenry/codegraph` 必须是插件的固定版本 `dependencies`，不是 peer dependency。
2. 插件安装应自动拉取匹配 OS/CPU 的 CodeGraph 平台包。
3. 插件不得运行 `npm install -g`、`pnpm add -g` 或修改 PATH。
4. 插件必须解析自身安装树中的 CLI 入口，避免调用系统中版本不确定的 `codegraph`。
5. 启动时记录插件版本、CodeGraph 版本、Node 版本和平台，但不得记录 Workspace 完整路径到遥测。
6. CodeGraph 包或平台构件缺失时，Runtime 进入 `degraded`，提示重新安装插件。

### FR-2：Workspace 身份与代码目录检测

1. Workspace Root 必须来自 Agent/Session 的可信 `header.cwd`。
2. 路径必须经过 `realpath` 并验证为现有目录。
3. Runtime Map 必须以规范化绝对路径为键。
4. 工具参数不得接受任意项目根目录覆盖当前 Session Workspace。
5. 符号、任务和文件查询参数不得通过路径穿越访问 Workspace Root 之外的文件。
6. 在解析 CLI 或执行任何写操作前，插件必须先完成代码目录检测；检测阶段可只读读取现有 `.codegraph/` 中与 ignore 规则有关的配置，但不得读取索引状态或修改该目录。
7. 检测器必须使用与锁定 CodeGraph 版本一致的受支持语言/扩展名集合，并尊重 `.gitignore`、可只读取得的 CodeGraph ignore 配置和内置排除项（至少包括 `.git/`、`.codegraph/`、依赖目录、构建产物和缓存目录）。
8. 检测到至少一个未被忽略的受支持源码文件时判定为代码目录；仅有 package manifest、锁文件、README、媒体、数据或空目录不得判定为代码目录。
9. 检测必须有遍历数量与耗时上限；超过上限时返回 `WORKSPACE_DETECTION_FAILED`，不得猜测为代码目录并执行 init。该 Workspace 的本次模型请求按无 CodeGraph 能力降级继续，后续请求可重试检测。
10. 非代码目录进入 `skipped`，不得执行 `codegraph init/status/sync/serve`，不得创建或修改 `.codegraph/`。
11. `skipped` 结果应基于轻量文件系统指纹缓存；指纹变化或缓存过期后重新检测，以支持目录后来新增源码。

### FR-3：自动激活与模型请求屏障

1. 插件只在 Workspace 第一次实际发送消息、首个模型请求 dispatch 之前检测并按需激活 Runtime。
2. 空白 Session 的创建、Workspace 列表展示和历史记录浏览不得触发检测或索引。
3. 同一个代码 Workspace 同时出现多个首条消息时，只允许一个准备流程执行，其他调用等待同一个 Promise。
4. Runtime 已 Ready 时不得重复运行初始化准备流程；但每条模型请求都要执行当前问题的上下文构建。
5. 插件必须挂接在模型供应商调用之前且支持异步等待的生命周期钩子；不得使用已经开始流式输出后的工具钩子模拟前置准备。
6. 代码 Workspace 的 Runtime 处于 Ready 且本次上下文注入完成时，才可作为增强请求放行模型；处于 Degraded 时仅可作为不带 CodeGraph 上下文和不可用 CodeGraph 工具的普通请求放行。
7. 准备、恢复、探活或上下文构建失败/超时时，不得注入不完整或过期的 CodeGraph 上下文；必须记录插件诊断，并以普通模型请求继续。不可用的 CodeGraph 工具不得暴露给模型。
8. 非代码 Workspace 的 `skipped` 是合法旁路状态，立即放行模型请求。

### FR-4：索引检测与初始化

1. 插件先检查 `<workspace>/.codegraph/` 是否存在，再通过 CodeGraph CLI 状态命令确认可用性；不得只根据目录存在判断健康。
2. 无索引时，以 Workspace Root 为 `cwd` 执行 `codegraph init`。
3. 已有健康索引时执行必要的增量同步，禁止无条件全量重建。
4. 索引损坏、schema 不兼容或 CLI 明确要求重建时，首版不得静默删除已有索引；应进入 `degraded` 并给出用户可操作诊断。
5. 首次 `init`/CLI `sync` 必须在 MCP watcher 启动前完成。Runtime 已在 watch 时，显式 `codegraph_sync` 必须先停止并关闭该 MCP Runtime，完成 CLI sync 与健康检查后再重建 MCP Runtime；不得让 CLI sync 与 watcher 同时写入索引。
6. `codegraph init` 进程启动不等于构建完成；插件必须等待命令成功退出，并再次执行健康检查，确认索引可查询、索引文件数大于零且不存在进行中的构建/迁移后，才能继续启动 MCP。
7. 初始化命令必须有可配置超时、输出上限和取消信号；超时前模型请求持续等待，超时后本次请求以不带 CodeGraph 能力的普通模型请求继续。
8. 初始化失败不得留下状态为 Ready 的 Runtime。

### FR-5：MCP Runtime

1. 每个 Workspace 启动一个 stdio MCP transport：

```sh
codegraph serve --mcp --path <workspace>
```

2. 首版默认设置 `CODEGRAPH_NO_DAEMON=1`，使进程生命周期明确归属于 DSH 插件。
3. 默认不得设置 `CODEGRAPH_NO_WATCH=1`，由 CodeGraph 自动监听文件变化。
4. 默认设置：

```text
CODEGRAPH_TELEMETRY=0
CODEGRAPH_NO_UPDATE_CHECK=1
```

`watch = false` 时设置 `CODEGRAPH_NO_WATCH=1`，不启动文件监听，也不以轮询或每条消息自动 sync 替代；用户可通过 `codegraph_sync` 显式同步。

5. MCP `initialize` 和 `tools/list` 成功后，还必须确认目标上下文工具存在，并以受控查询完成一次探活；只有探活成功后 Runtime 才能以 MCP 后端进入 Ready。
6. MCP 意外退出时，插件应执行有界指数退避重连；达到上限后进入 Degraded。
7. 重连期间不得启动第二个同 Workspace Runtime；新的模型请求不使用 CodeGraph 上下文或工具而正常继续。
8. 成功重连并重新探活后恢复 Ready，并继续复用原 Runtime 身份。

### FR-6：问题驱动的上下文构建与直接注入

1. 对每条即将发送到模型的代码 Workspace 用户消息，插件必须将该消息的原始文本作为自然语言查询；优先调用锁定版本中经过契约测试的 `buildContext`/`codegraph_context`，否则调用 `codegraph_explore`。不拼接历史消息、模型输出或仓库内容作为查询文本。
2. 自动查询发生在模型 dispatch 前，不消耗模型工具调用轮次，也不依赖模型决定是否使用 CodeGraph。
3. 查询成功后，将返回的相关源码、文件路径、行号、调用路径和影响摘要转换为长度受限的文本块，注入本次模型消息上下文。
4. 注入内容必须使用明确边界和来源标签，例如 `CodeGraph generated context (untrusted repository content)`；仓库源码中的指令一律作为不可信数据，不得覆盖 system/developer 指令。
5. 注入顺序必须稳定：系统与开发者指令优先，随后是插件生成的 CodeGraph 上下文，再随后是当前用户消息；不得篡改用户原文。
6. 必须支持字符/token 上限、去重和截断，并在截断时保留来源文件与行号；不得把无限 MCP 输出送入模型。
7. 空结果属于有效结果，可注入简短的“未找到相关上下文”标记后放行；MCP 错误、超时或 schema 不匹配不属于空结果，应放弃本次自动注入并以普通模型请求继续。
8. 自动注入不能替代模型可见的 CodeGraph 工具；模型在回答过程中仍可按需继续调用工具补充上下文。
9. 日志只记录查询耗时、结果大小和截断状态，不记录用户问题全文或源码内容。

### FR-7：DSH 工具暴露

首版至少提供：

- `codegraph_explore`：针对任务、问题或符号返回相关源码和关系上下文；
- `codegraph_node`：返回一个符号或文件的详细信息；
- `codegraph_status`：返回当前 Workspace 的索引和 Runtime 状态；
- `codegraph_sync`：显式请求一次增量同步与健康检查。

若锁定的 CodeGraph 版本稳定暴露并完成适配，可增加：

- `codegraph_search`
- `codegraph_context`
- `codegraph_callers`
- `codegraph_callees`
- `codegraph_impact`
- `codegraph_trace`
- `codegraph_files`

要求：

1. DSH 工具名和 schema 由本插件拥有，不直接把上游动态工具列表无约束透传给模型。
2. 插件必须锁定并测试 CodeGraph 版本与 MCP schema，避免上游更新静默改变模型工具协议。
3. 每次执行根据 `exec.agent.session.header.cwd` 路由到对应 Runtime。
4. 输出必须转换为 DSH 支持的规范 JSON 值和有界模型文本。
5. 大输出必须截断或交给 DSH 已有 spill 机制，不能无限写入会话上下文。
6. MCP 返回 `isError`、连接断开或 schema 不匹配时，DSH 工具必须返回明确失败，不得伪装成功。

### FR-8：CLI 降级

插件支持：

```ts
type BackendMode = 'mcp' | 'cli' | 'auto'
```

默认 `auto`：

1. `init`、`status`、MCP 启动前的 `sync` 使用 CLI。
2. 正常模型查询优先使用 MCP。
3. MCP 启动或连接失败时，只有存在等价且经过测试的 CLI 命令才允许将 Runtime 恢复为 `ready`（`backend: 'cli'`）；CLI 也不可用时，Runtime 保持 `degraded`，但模型请求仍按普通请求放行。
4. 首版 CLI 降级至少覆盖 `status`、`sync`、`explore` 和 `node`；其他能力无可靠 CLI 等价时返回 Degraded 错误。
5. MCP 业务层返回“符号不存在”等正常错误时不得自动切换 CLI。
6. 降级结果必须标明 `backend: 'cli'`，便于诊断。

### FR-9：并发控制

每个 Workspace Runtime 至少维护：

```ts
interface WorkspaceRuntime {
  root: string
  state:
    | 'new'
    | 'detecting'
    | 'skipped'
    | 'checking'
    | 'initializing'
    | 'syncing'
    | 'connecting'
    | 'probing'
    | 'ready'
    | 'degraded'
    | 'closing'
    | 'closed'
  preparePromise?: Promise<void>
  mutationTail: Promise<void>
  client?: unknown
  transport?: unknown
  child?: unknown
  lastError?: RuntimeDiagnostic
  startedAt?: string
  lastReadyAt?: string
}
```

约束：

1. `init`、`sync`、重建连接和关闭操作必须避免竞态。
2. 一个 Workspace 只能存在一个 `preparePromise`。
3. 状态迁移必须符合显式状态转移表且可测试；`closing/closed` 不得返回 Ready。`degraded → checking/connecting/probing → ready` 是允许的恢复路径，不属于“单调”限制。
4. 多 Session 并发查询可以共享 MCP，但必须符合 MCP client 的并发能力；不支持时由插件串行化调用。
5. 关闭必须等待或取消所有插件拥有的异步工作，禁止遗留未观察 Promise。

### FR-10：失败与恢复

稳定诊断至少包括：

```ts
type CodeGraphErrorCode =
  | 'CLI_NOT_FOUND'
  | 'PLATFORM_BUNDLE_MISSING'
  | 'WORKSPACE_INVALID'
  | 'WORKSPACE_DETECTION_FAILED'
  | 'INIT_TIMEOUT'
  | 'INIT_FAILED'
  | 'INDEX_UNHEALTHY'
  | 'SYNC_FAILED'
  | 'MCP_START_FAILED'
  | 'MCP_DISCONNECTED'
  | 'MCP_TOOL_UNAVAILABLE'
  | 'MCP_SCHEMA_MISMATCH'
  | 'MCP_PROBE_FAILED'
  | 'CONTEXT_BUILD_TIMEOUT'
  | 'CONTEXT_BUILD_FAILED'
  | 'PLUGIN_CLOSING'
```

1. 代码 Workspace 首次准备失败后，不得导致 DSH Host 退出；该次模型请求须作为不带 CodeGraph 上下文和不可用 CodeGraph 工具的普通请求继续，同时向用户显示可收起的诊断。不得将失败结果伪装成已注入上下文。
2. 非代码 Workspace 不依赖 CodeGraph，正常模型请求不受 CodeGraph CLI/MCP 故障影响。
3. CodeGraph 工具调用和前置准备失败均返回错误码、简短原因和建议动作。
4. 临时 MCP 断开允许自动恢复；恢复期间新的模型请求按普通请求继续，达到重连上限后 Runtime 保持 Degraded，后续请求仍可重试恢复。
5. `codegraph_sync` 可作为用户触发的恢复入口，但不得在索引明确损坏时静默删除重建。
6. 日志不得输出源码内容、完整 MCP 查询结果、用户问题全文或环境变量。

### FR-11：配置

首版配置建议：

```ts
interface Config {
  backend: 'mcp' | 'cli' | 'auto'
  autoInit: 'always' | 'never'
  autoSync: boolean
  watch: boolean
  codeDetectionTimeoutMs: number
  codeDetectionMaxEntries: number
  skippedCacheTtlMs: number
  prepareTimeoutMs: number
  contextBuildTimeoutMs: number
  contextMaxTokens: number
  toolCallTimeoutMs: number
  shutdownGraceMs: number
  reconnect: {
    enabled: boolean
    initialDelayMs: number
    maxDelayMs: number
    maxAttempts: number
  }
  telemetry: boolean
  updateCheck: boolean
  noDaemon: boolean
}
```

默认值：

```text
backend = auto
autoInit = always
autoSync = true
watch = true
codeDetectionTimeoutMs = 5000
codeDetectionMaxEntries = 10000
skippedCacheTtlMs = 30000
prepareTimeoutMs = 300000
contextBuildTimeoutMs = 60000
contextMaxTokens = 12000
toolCallTimeoutMs = 60000
shutdownGraceMs = 5000
reconnect.enabled = true
telemetry = false
updateCheck = false
noDaemon = true
```

`autoInit = never` 时，无索引的代码 Workspace 进入 Degraded，并提示用户手动执行初始化；插件不得自行写入 `.codegraph/`，并以无 CodeGraph 能力的普通模型请求继续。非代码 Workspace 始终为 Skipped。

## 8. 技术架构

### 8.1 模块建议

```text
src/
  index.ts                 # Cordis plugin 入口、工具注册、dispose
  config.ts                # 配置 schema 与默认值
  manager.ts               # WorkspaceRuntimeManager
  runtime.ts               # 单 Workspace 状态机
  workspace.ts             # header.cwd、realpath 与边界检查
  detector.ts              # 受支持源码、ignore 规则与代码目录判定
  gate.ts                  # 模型 dispatch 前的异步准备屏障
  context.ts               # 问题驱动查询、边界标记、限长与上下文注入
  cli/
    resolve.ts             # 定位插件私有 CLI
    runner.ts              # 受控子进程执行、超时、取消、输出上限
    commands.ts            # init/status/sync/explore/node
  mcp/
    client.ts              # stdio MCP client 创建与关闭
    adapter.ts             # 上游 MCP ↔ DSH 工具协议转换
    schemas.ts             # 锁定版本的工具 schema
  tools/
    explore.ts
    node.ts
    status.ts
    sync.ts
  errors.ts
  types.ts
```

### 8.2 Runtime Manager

```text
WorkspaceRuntimeManager
  ├─ Map<canonicalRoot, WorkspaceRuntime>
  ├─ ensureForAgent(agent)
  ├─ getForExecution(exec)
  ├─ retry(root)
  └─ closeAll()
```

Manager 只接受由 Agent Session 推导出的路径，不提供任意路径形式的公开工具参数。

Workspace Runtime、状态转移表、共享 Promise、重连计数和诊断只保存在插件进程内的 `Map`，不需要也不得另行落库；跨 DSH 重启仅复用 Workspace 内的 `.codegraph/` 索引，重新创建 Runtime。

### 8.3 工具注册策略

DSH 工具在插件激活时注册一次，并保持稳定 schema。Workspace Runtime 可以稍后准备；工具执行时路由到当前 Workspace。这样不会因为打开多个 Workspace 重复注册同名工具，也不会因为某个 MCP 重连改变模型工具集合。

### 8.4 CodeGraph 版本策略

1. 首版固定精确 CodeGraph 版本，不使用 `latest` 或宽泛 semver 范围。
2. 升级 CodeGraph 前必须重新运行 MCP schema、CLI 行为、生命周期和多 Workspace 测试。
3. 插件版本发布说明必须记录对应 CodeGraph 版本。
4. 上游 MCP 默认工具暴露面变化不得直接影响 DSH 工具集合。

## 9. 安全、隐私与资源约束

1. CodeGraph 源码和索引保留在 Workspace 本地。
2. 默认禁用 CodeGraph 匿名遥测和版本检查。
3. 子进程环境使用最小化白名单，不传递无关凭据。
4. 不允许模型传入 `cwd`、CLI 可执行路径、任意环境变量或额外 CLI flags。
5. 初始化写入仅允许发生在规范化 Workspace Root 的 `.codegraph/`。
6. `.codegraph/` 不应自动提交；首版可以提示用户加入 `.gitignore` 或 `.git/info/exclude`，但不得未经设计直接修改版本控制文件。
7. CLI stdout/stderr 必须设置字节上限，防止日志或工具结果耗尽内存。
8. 大型仓库初始化应受超时控制，并显示可理解的失败信息。
9. 插件应记录每个 Workspace Runtime 的资源状态，但默认不记录源码、符号名和查询内容。

## 10. 可观测性

Host 日志至少记录：

- Runtime 创建与关闭；
- 状态迁移；
- init/sync/MCP 启动的开始、完成、耗时和退出码；
- MCP 断开、重连次数和最终降级；
- CodeGraph 版本和兼容性错误。

日志中的 Workspace 使用稳定短 hash 或标题，默认不输出完整绝对路径。不得输出源码、查询正文、模型消息或环境变量值。

`codegraph_status` 至少返回：

```ts
interface CodeGraphStatusResult {
  state: 'new' | 'detecting' | 'skipped' | 'preparing' | 'ready' | 'degraded' | 'closing'
  backend: 'mcp' | 'cli' | null
  isCodeWorkspace: boolean | null
  indexed: boolean
  watching: boolean
  codegraphVersion?: string
  lastReadyAt?: string
  diagnostic?: {
    code: CodeGraphErrorCode
    message: string
    retryable: boolean
  }
}
```

## 11. 测试策略

### 11.1 单元测试

1. Workspace 路径规范化与非法路径拒绝。
2. Runtime 状态机合法/非法迁移。
3. 同 Workspace 并发 `ensure()` 只执行一次 prepare。
4. 不同 Workspace 创建独立 Runtime。
5. CLI 路径解析不依赖系统 PATH。
6. CLI timeout、取消、输出截断和非零退出码映射。
7. MCP 响应到 DSH 规范输出的转换。
8. Degraded 错误码和可重试属性。
9. 代码目录检测：支持源码、纯文档目录、忽略目录、遍历上限和 skipped 缓存失效。
10. 模型请求屏障在 Ready 前不调用 provider，失败/超时时不发生 provider 调用。
11. 自动上下文查询使用当前用户问题，注入顺序、边界标签、去重和 token 截断稳定。
12. dispose 后拒绝创建新 Runtime。

### 11.2 集成测试

使用临时小型仓库和真实或受控 CodeGraph CLI 验证：

1. 含受支持源码且无 `.codegraph/` 时，首条消息触发一次 init。
2. 纯文档、数据或空 Workspace 不执行 init、不创建 `.codegraph/`、不启动 MCP，模型正常响应。
3. init 仍在运行或健康检查未通过时，mock provider 的调用次数在准备超时前保持为 0；准备失败或超时后恰有一次不带 CodeGraph 上下文及工具的降级 provider 调用。
4. 已有索引时不执行全量 init。
5. Runtime Ready 后，插件先用当前问题调用 `codegraph_explore`，其结果出现在 provider 收到的上下文中。
6. 上下文构建失败或超时时，provider 收到不带 CodeGraph 上下文及工具的降级请求，并向用户显示诊断。
7. 修改源文件后 watcher 使下一次自动注入结果更新。
8. 两个 Session 共享同 Workspace MCP Runtime。
9. 两个 Workspace 不共享索引或 MCP Runtime。
10. MCP 崩溃后按策略重连；重连期间 provider 请求不含 CodeGraph 上下文及工具而正常调用。
11. DSH/plugin dispose 后子进程退出且 `.codegraph/` 保留。
12. DSH 重启模拟后复用索引并恢复监听。
13. 遥测与更新检查默认环境变量生效。

### 11.3 兼容性测试

至少覆盖：

- macOS arm64；
- macOS x64（CI 可用时）；
- Linux x64；
- Node 22 与当前 DSH 使用的 Node 24；
- CodeGraph 锁定版本的 npm 标准 registry 安装。

Windows 支持可在首版声明实验性，待补充进程关闭、路径和平台包测试后升级为正式支持。

## 12. 验收标准

### AC-1：自动依赖

全新环境只安装 `dsh-codegraph-plugin` 后，插件能够启动自己依赖中的 CodeGraph CLI；系统 PATH 中没有 `codegraph` 也能工作。

### AC-2：首次初始化

给定一个包含受支持源码且无 `.codegraph/` 的测试 Workspace，第一次发送消息只执行一次 `codegraph init`；必须等待命令成功退出、索引健康检查、MCP 初始化、工具发现和探活全部通过后 Runtime 才为 Ready。

### AC-3：索引复用

关闭并重新启动插件后，同一 Workspace 不执行全量 init，能够通过状态检查、同步和 MCP 重连恢复 Ready。

### AC-4：持续监听

Runtime Ready 后修改一个受支持源文件，在集成测试夹具规定的 10 秒窗口内，CodeGraph 查询返回更新后的符号或源码；超时必须输出 watcher 诊断。

### AC-5：会话共享

同一 Workspace 两个并发 Session 只存在一个 prepare Promise、一个 MCP Runtime 和一个 watcher。

### AC-6：Workspace 隔离

两个 Workspace 的工具调用分别查询自身代码，不能通过工具参数切换或越界到另一个 Workspace。

### AC-7：自动清理

插件 dispose 后，所有由插件直接拥有的 CodeGraph MCP 子进程在关闭宽限期内退出；进程退出后 `.codegraph/` 仍存在。

### AC-8：优先准备与安全降级

对于代码 Workspace，CodeGraph CLI 缺失、初始化失败、构建超时、MCP 未 Ready、探活失败或自动上下文查询失败时，Host 保持运行；准备超时或失败后，provider 收到一次不带 CodeGraph 自动上下文及不可用 CodeGraph 工具的普通请求，并向用户显示稳定诊断。对于非代码 Workspace，模型调用正常进行。

### AC-9：隐私默认值

默认运行环境明确包含 `CODEGRAPH_TELEMETRY=0` 和 `CODEGRAPH_NO_UPDATE_CHECK=1`，且测试确认插件不覆盖用户源码或发送查询内容。

### AC-10：无 SDK 调用

生产代码不得从 `@colbymchenry/codegraph` 主库入口 import `CodeGraph`、`DatabaseConnection`、`QueryBuilder` 或其他 SDK API；只允许解析/执行该依赖提供的 CLI 构件。

### AC-11：非代码目录零副作用

给定仅含 Markdown、图片或数据文件的 Workspace，发送消息后状态为 Skipped；不存在新的 `.codegraph/`，未执行任何 CodeGraph CLI/MCP 命令，模型正常收到请求。

### AC-12：问题相关上下文自动注入

给定 Ready 的代码 Workspace 和用户问题，插件在 provider 调用前以该问题执行一次 `codegraph_explore`/等价上下文构建；provider 收到带来源边界、文件与行号且不超过配置上限的上下文。无需模型先发起工具调用。

## 13. 里程碑

### M0：宿主与上游契约确认

- 用最小 POC 验证 DSH provider dispatch 前的异步拦截、请求取消及上下文注入能力；
- 锁定 CodeGraph 精确版本、CLI 入口、支持语言/ignore 规则和 MCP `buildContext`（或等价工具）schema；
- 固化 CLI/MCP 契约测试夹具、DSH token 预算与工具输出上限；
- 未完成以上确认不得开始依赖这些契约的 M1/M2 实现。

### M1：CLI 与 Workspace Runtime 基础

- 包结构、构建与测试配置；
- CodeGraph 依赖和 CLI 定位；
- Workspace 路径解析与代码目录检测；
- Runtime Manager 与状态机；
- 模型 dispatch 前异步屏障；
- init/status/sync 与完整构建确认；
- dispose 清理。

### M2：MCP 查询能力

- stdio MCP client；
- 每 Workspace MCP 生命周期；
- `explore/node/status/sync` 工具；
- 当前问题的自动 explore/context 查询与模型上下文注入；
- 重连与 Degraded；
- 注入边界、去重与输出限制。

### M3：自动监听与多 Workspace 验证

- 首条消息激活；
- watcher 更新测试；
- 多 Session 复用；
- 多 Workspace 隔离；
- DSH 重启和关闭测试。

### M4：扩展工具与发布

- search/context/callers/callees/impact/trace/files 适配；
- 跨平台兼容性；
- README、安装说明、故障排查；
- 打包与发布检查。

## 14. 风险与缓解

| 风险                                 | 影响                                       | 缓解                                                               |
| ------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------ |
| CodeGraph MCP 工具列表或 schema 变化 | DSH 工具调用失败                           | 锁定精确版本，维护 adapter 和契约测试                              |
| 首次索引大型仓库耗时长               | 第一条消息等待且模型尚未调用               | 可配置超时、阶段状态与 Web 进度；超时后明确失败，不得静默旁路      |
| 代码目录误判                         | 非代码目录被写入索引，或代码目录缺少上下文 | 与 CodeGraph 锁定版本共享语言清单、尊重 ignore、检测上限与集成夹具 |
| 自动注入上下文过大或含提示注入       | 挤占模型窗口或影响指令遵循                 | token 上限、去重、稳定边界标签，将仓库内容明确标记为不可信数据     |
| 多 Session 同时初始化                | SQLite 锁或重复进程                        | Workspace 级单例 Promise 和串行 mutation tail                      |
| MCP daemon 脱离 DSH 生命周期         | 应用关闭后残留进程                         | 首版默认 `CODEGRAPH_NO_DAEMON=1`                                   |
| MCP watcher 与 CLI sync 同时写入     | 锁冲突                                     | 先 init/sync，再启动 MCP；Runtime 内串行写操作                     |
| 平台包未被镜像同步                   | CLI 无法启动                               | 安装诊断、锁定版本、CI 校验标准 registry 与目标平台                |
| 索引损坏                             | 查询错误或启动失败                         | 不静默删除；Degraded 并提供显式恢复说明                            |
| Workspace 路径混淆                   | 查询错误仓库或越权                         | 只信任 session header.cwd、realpath、禁止工具覆盖 cwd              |
| CLI 文本输出变更                     | 降级解析失败                               | 仅依赖退出码和稳定命令；文本适配加版本契约测试                     |

## 15. 开发前需产出的契约

1. DSH provider dispatch 前可异步等待、取消请求及注入上下文的稳定 hook 名称、输入/输出契约和最小 POC。
2. 锁定 CodeGraph 版本的 CLI 绝对入口解析方式、平台 shim 布局及 macOS/Linux 启动夹具。
3. 锁定版本的 MCP 启动参数、`CODEGRAPH_MCP_TOOLS` 精确取值，以及自然语言 `buildContext`/`codegraph_context`（否则 `codegraph_explore`）的请求与响应 schema。
4. 支持语言清单、ignore 规则来源和只读读取现有 `.codegraph/` ignore 配置的规则。
5. DSH 模型请求的可用 token 预算、token 计算器、MCP/Tool 输出上限及 spill 服务复用方案。
6. Cordis dispose 的子进程关闭 helper、跨平台测试夹具及 Windows 首版支持等级。

## 16. 最终产品决策摘要

1. 使用 CLI + stdio MCP，不使用 CodeGraph SDK。
2. CodeGraph CLI 作为插件固定版本依赖安装，不执行全局安装。
3. 激活点是 Workspace 第一次实际发送消息、provider dispatch 之前，而不是仅打开或浏览 Workspace。
4. 先检测是否为代码目录；只有含受支持且未忽略源码的目录才可 init，非代码目录 Skipped 且零写入。
5. 代码目录无索引时默认自动 init 并等待完整构建；已有索引时复用并同步。
6. 代码目录优先等待 CodeGraph Ready 并完成本次上下文构建；未 Ready 或构建失败时，以不含 CodeGraph 上下文及不可用工具的普通模型请求降级继续。
7. 每条代码 Workspace 用户消息都先通过 `codegraph_explore`/等价能力按问题构建上下文并直接注入模型输入。
8. MCP 默认开启 CodeGraph watcher，并持续到 DSH/plugin 关闭。
9. 同 Workspace 多 Session 共享 Runtime；不同 Workspace 严格隔离。
10. 插件关闭时终止自己拥有的进程，但永久保留 `.codegraph/`。
11. 默认关闭 CodeGraph 遥测、更新检查和脱离插件生命周期的 daemon。
12. CodeGraph 失败不得拖垮 Host；代码 Workspace 的对应模型请求降级为普通对话，且不暴露不可用 CodeGraph 工具或不完整上下文；非代码 Workspace 正常对话。
13. 上游版本与协议必须锁定并经过兼容性测试后升级。
