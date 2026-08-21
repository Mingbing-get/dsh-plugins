# dsh-drawing-plugin

DeepSeek Harness 的 AI 单图编辑插件。当前已实现会话级 raster 文档内核与受限 Host 工具：`create_image`、`query_image`、`edit_image`、`undo_image`、`redo_image`。

内核使用固定尺寸 RGBA 位图，而非无限画布。基础编辑支持填充、清除、矩形、椭圆、多边形、线条、画笔、受选区限制的 flood fill、改色、裁切、缩放与翻转；每次编辑是带版本校验的原子事务，失败会完整回滚，撤销/重做共享同一历史。浏览器会根据成功工具调用的参数，以 Canvas 回放并自动刷新画面；工具结果只返回成功状态，不传输 PNG 或图片 attachment。`render_image` 已移除，窗口的“保存 PNG”直接下载本地 Canvas 预览。

完整需求、边界和验收标准见 [PRD.md](./PRD.md)。下一阶段会接入 Web 浮窗、框选上下文、PNG 渲染/下载以及 AI inpaint/outpaint bridge。

## 大模型调用操作说明

这是一个**确定性像素绘图**工具，不是文生图模型。模型应把用户意图拆成几何图形、色块、线条和像素操作；不要传 prompt、图片 URL、Base64、文件路径、SVG、Canvas 代码或未列出的滤镜参数。

### 必须遵守的调用流程

1. 当前会话没有画布时，调用 `create_image`。
2. 读取每次成功返回的 `version`。下一次 `edit_image`、`undo_image` 或 `redo_image` 必须把它原样传到 `expectedVersion`。
3. 每次成功操作都会令 `version` 加 1；**绝不能复用旧版本号**。若收到版本不一致错误，调用 `query_image({ scope: 'summary' })`，再用返回的新版本重试一次。
4. 调用 `edit_image` 时必须给出 `selection` 和包含 1–32 项的 `ops`。有活动选区时用 `{ type: 'current' }`；指定局部范围时用完整且非空的 `{ type: 'rect', x, y, w, h }`（四项都必填，`w`、`h` 均大于 0）。用户明确要求全图，或刚创建的空白画布需要绘制完整构图时，使用 `{ type: 'all' }`。绝不能发送空对象、缺少 `w` / `h` 的 `rect` 或零大小矩形。
5. 一组彼此依赖的动作可放进同一次 `ops`，它们会原子提交：其中任一项非法，整组不会修改图像。需要中间结果或不同区域时，拆成多次调用并使用新版本号。

`query_image` 只返回尺寸、版本、选区和透明度统计，不能识别画面内容或像素颜色。因此模型应基于自己刚才绘制的坐标继续编辑，并在不能确定位置时询问用户。

### `create_image`

```ts
create_image({
  width: 1024,
  height: 768,
  background: '#fff7ed',
})
```

| 参数              | 用法                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `width`、`height` | 必填整数，单位为像素；范围均为 `1–4096`，总像素数不超过 `16,777,216`。                                                                            |
| `background`      | 可省略，默认 `transparent`。只能为 `transparent`、`#RRGGBB` 或 `#RRGGBBAA`，例如 `#ffffff`、`#10203080`。不能使用颜色名称、`rgb()` 或三位短色值。 |
| `replace`         | 仅用户明确说“重新开始”“覆盖当前图”时使用 `true`；否则已有画布会被拒绝，防止误覆盖。                                                               |

成功结果中的 `version` 初始为 `1`，它就是第一笔编辑的 `expectedVersion`。

### `query_image`

```ts
query_image({ scope: 'summary' })
query_image({ scope: 'region', bounds: { x: 0, y: 0, w: 200, h: 120 } })
```

`scope` 必填：`summary` 查询全图状态；`selection` 查询当前选区（没有选区时返回全图）；`region` 查询给定 `bounds` 的透明度统计。`bounds` 仅在 `region` 时必填，格式为 `{ x, y, w, h }`，且必须是非空矩形。

### `edit_image` 的公共参数

```ts
edit_image({
  expectedVersion: 1,
  selection: { type: 'rect', x: 80, y: 60, w: 320, h: 220 },
  ops: [{ op: 'ellipse', x: 120, y: 90, w: 160, h: 160, color: '#fbbf24' }],
})
```

| 参数              | 用法                                                                                                                                                                                                                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expectedVersion` | 必填整数，必须等于上一次成功结果的 `version`。                                                                                                                                                                                                                                                            |
| `selection`       | 必填，限制普通绘制可写入的区域。`{ type: 'all' }` 为全图（仅明确全图操作或新建空白画布的完整构图）；`{ type: 'rect', x, y, w, h }` 为矩形，四个数值必须齐全且 `w`、`h` 大于 0；`{ type: 'current' }` 只在系统已提供活动选区时可用。当前没有选区时不要猜测使用 `current`；也不要用空或零大小 `rect` 代替。 |
| `ops`             | 必填数组，长度 `1–32`。数组内按顺序执行。                                                                                                                                                                                                                                                                 |

坐标原点在左上角，`x` 向右、`y` 向下，单位为像素。`w`、`h` 必须大于 0。几何图形会裁剪到画布和 `selection` 内。所有 `color`、`from`、`to` 及 `colors` 数组中的元素必须为 `#RRGGBB` 或 `#RRGGBBAA`；`opacity` 是 `0–1` 的数字，省略即为 `1`。

### `ops` 参数速查

| `op`              | 必填字段                                               | 可选字段与说明                                                                                            |
| ----------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `fill`            | `color`                                                | `opacity`；填满整个 `selection`。                                                                         |
| `clear`           | 无                                                     | 清空 `selection` 为透明。                                                                                 |
| `linear_gradient` | `x1`, `y1`, `x2`, `y2`，以及 `from` + `to` 或 `colors` | `colors` 为 2–16 个颜色，按顺序均匀插值；`opacity` 可选。用于背景、天空、光影，勿用多条 `rect` 模拟渐变。 |
| `radial_gradient` | `cx`, `cy`, `radius`，以及 `from` + `to` 或 `colors`   | `colors` 为 2–16 个颜色，按中心向外顺序均匀插值；`opacity` 可选。用于光晕、球体明暗与柔和阴影。           |
| `rect`            | `x`, `y`, `w`, `h`, `color`                            | `opacity`；实心矩形。                                                                                     |
| `ellipse`         | `x`, `y`, `w`, `h`, `color`                            | `opacity`；椭圆外接矩形。                                                                                 |
| `polygon`         | `points`, `color`                                      | `opacity`；`points` 为至少 3、最多 128 个 `{x,y}` 顶点。                                                  |
| `line`            | `x1`, `y1`, `x2`, `y2`, `color`                        | `radius`（笔触半径，`>0` 且不超过 512，默认 1）、`opacity`。                                              |
| `brush`           | `points`, `color`                                      | `radius`、`opacity`；`points` 为 1–1024 个 `{x,y}` 点，内核会在相邻点间连续补笔，适合有机轮廓。           |
| `flood_fill`      | `x`, `y`, `color`                                      | `tolerance`（`0–255`，默认 0）；种子点必须在 `selection` 内，填充不会越过该选区。                         |
| `replace_color`   | `from`, `to`                                           | `tolerance`（`0–255`，默认 0）；仅替换 `selection` 内 RGBA 每通道误差均不超过容差的像素。                 |
| `crop`            | `x`, `y`, `w`, `h`                                     | 裁切并改变画布尺寸；完成后选区会清除。建议单独一次调用。                                                  |
| `resize`          | `width`, `height`                                      | 新尺寸限制同创建画布；使用最近邻缩放，完成后选区会清除。建议单独一次调用。                                |
| `flip`            | `axis`                                                 | `axis` 只能是 `horizontal`（左右翻转）或 `vertical`（上下翻转）。                                         |

示例：在浅色背景上画一个太阳和地平线。一次成功后，使用结果的 `version` 继续下一笔。

```ts
edit_image({
  expectedVersion: 1,
  selection: { type: 'all' },
  ops: [
    { op: 'fill', color: '#e0f2fe' },
    { op: 'ellipse', x: 380, y: 110, w: 160, h: 160, color: '#f59e0b' },
    { op: 'line', x1: 0, y1: 500, x2: 1023, y2: 500, color: '#0f766e', radius: 4 },
  ],
})
```

### 撤销与重做

```ts
undo_image({ expectedVersion: 2 })
redo_image({ expectedVersion: 3 })
```

一次 `edit_image`（即使有多个 `ops`）只对应一个历史记录。撤销或重做同样会产生新版本号，后续调用必须使用其返回的版本。

### 常见失败与恢复

| 错误情形                                  | 正确做法                                                                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expectedVersion does not match`          | 查询 `summary` 获取新版本；只重试一次，且不要重放一个可能已成功的请求。                                                                                       |
| 已有图像时再次创建                        | 没有明确覆盖授权时，改为 `edit_image`；有授权才传 `replace: true`。                                                                                           |
| `selection must be a non-empty rectangle` | `rect` 缺少 `x`、`y`、`w`、`h`，`w` / `h` 不大于 0，或整块区域都在画布外。改用完整的非空 `rect`；有活动选区时用 `current`；新建空白画布的完整构图可用 `all`。 |
| `selection` 非法或 `current` 无选区       | 用完整的 `{ type: 'rect', x, y, w, h }` 指定范围；仅明确全图操作或新建空白画布的完整构图时使用 `{ type: 'all' }`。                                            |
| 颜色格式错误                              | 改成完整的 `#RRGGBB` / `#RRGGBBAA`，例如 `#22c55e`，不要用 `red`、`#fff`。                                                                                    |
| 不支持的操作                              | 仅使用上表列出的 12 种 `op`；不要使用 PRD 中尚未实现的 `text`、`inpaint`、`rotate`、`generate` 等操作。                                                       |

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
