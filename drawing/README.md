# dsh-drawing-plugin

DeepSeek Harness 的 AI 单图编辑插件。当前已实现会话级 raster 文档内核与受限 Host 工具：`create_image`、`query_image`、`edit_image`、`undo_image`、`redo_image`。

内核使用固定尺寸 RGBA 位图，而非无限画布。基础编辑支持填充、清除、矩形、椭圆、多边形、线条、画笔、受选区限制的 flood fill、改色、裁切、缩放与翻转；每次编辑是带版本校验的原子事务，失败会完整回滚，撤销/重做共享同一历史。`render_image` 与 `save_image` 使用 Harness 的受控 PNG attachment，不暴露原始像素、Base64 或文件路径。

完整需求、边界和验收标准见 [PRD.md](./PRD.md)。下一阶段会接入 Web 浮窗、框选上下文、PNG 渲染/下载以及 AI inpaint/outpaint bridge。

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
src/index.ts      # Host 工具注册与 session 文档隔离
src/raster.ts     # 事务、版本、历史与基础 raster 操作
tests/            # raster 内核单元测试
PRD.md            # 产品需求文档
```

正式发布前，将移除 `private: true`，补充运行依赖和实现，并按仓库的 Changesets 流程发版。
