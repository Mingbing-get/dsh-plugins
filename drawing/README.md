# dsh-drawing-plugin

DeepSeek Harness 的 AI 绘图插件骨架。当前版本只定义工程结构和产品协议，尚未集成画布、注册工具或实现前端。

计划采用 `tldraw` 作为无限画布内核，并为模型提供三个受限能力：`query_canvas`、`apply_canvas_ops`、`render_canvas`。完整需求、边界和验收标准见 [PRD.md](./PRD.md)。

## 开发

```sh
cd /Users/mingbing/apps/ai-project/dsh-plugins
pnpm install
pnpm --filter @meing/dsh-drawing-plugin test
pnpm --filter @meing/dsh-drawing-plugin build
pnpm --filter @meing/dsh-drawing-plugin pack:check
```

## 目录

```text
src/              # Host、工具协议与画布适配层（待实现）
src/client/       # tldraw 画布和工具 UI（待实现）
tests/            # 协议、状态和视觉回归测试（待实现）
PRD.md            # 产品需求文档
```

正式发布前，将移除 `private: true`，补充运行依赖和实现，并按仓库的 Changesets 流程发版。
