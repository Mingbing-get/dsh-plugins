# DeepSeek Harness AI 单图绘制与编辑插件 PRD

- 文档状态：Draft
- 插件目录：`drawing/`
- 暂定包名：`@meing/dsh-drawing-plugin`
- 目标平台：DeepSeek Harness Web
- 首版内核：单文档 Raster Editor（Canvas 2D + OffscreenCanvas）
- 当前状态：仅工程骨架与协议设计；不包含可运行的编辑器实现

## 1. 背景与决策

用户希望模型能在会话中创建、观看和精确修改一张图片：既能按自然语言生成或局部重绘，也能按像素坐标绘制、填充、擦除、改色和框选编辑。用户还需要直接在 Web 界面框选图片区域，并让该区域自动成为下一次向模型发送消息时的上下文。

本插件**不是**流程图或无限白板。每个 Agent session 只维护一份 `ImageDocument`，同一时刻只显示和编辑一张图。首版不使用 tldraw：其对象画布、连接线和图形关系不能为单图像素编辑提供足够收益，反而会增加状态与交互复杂度。

## 2. 产品目标

1. 用户或模型可创建一张透明或带背景色的固定尺寸图片，并在当前会话持续编辑它。
2. 模型通过受限、声明式工具精确修改图像，不接触 DOM、`CanvasRenderingContext2D`、文件路径或任意脚本执行能力。
3. 模型开始创建或编辑图像时，客户端自动弹出无蒙层、可拖动的实时绘图窗口；图像按操作或 tile 进度即时刷新。
4. 用户能在窗口内缩放、平移和框选；最近一次有效框选会自动注入下一次用户消息的模型上下文。
5. 用户可随时显示或关闭窗口；每条相关工具记录右侧都有“显示画面”按钮，行为与 `gomoku` 插件的“显示棋盘”一致。
6. 用户可将当前图像下载保存为 PNG；导出内容与当前已提交版本一致。
7. 所有编辑均为原子事务，支持撤销/重做和版本校验，失败不留下半张图或半次修改。

## 3. 非目标

首版不负责：

1. 多张图、多页文档、自由画布、流程图、矢量图层或多人协作。
2. PSD/SVG 编辑、专业调色、复杂图层混合、钢笔路径和桌面级修图工作流。
3. 将整张原始 RGBA 数据、PNG Base64 或逐像素坐标列表暴露给模型。
4. 让模型在用户未指定或未框选的区域进行破坏性局部 AI 编辑。
5. 跨会话持久化与云端图库；会话结束后文档不保证可恢复。

## 4. 核心体验

### 4.1 创建与实时显示

用户说“画一张日落海边插画”，模型调用 `create_image` 或 `edit_image`。客户端收到开始事件后立即打开绘图窗口，标题显示“AI 正在绘制”，并在生成图到达、tile 写入或本地绘制完成时刷新预览。窗口无背景蒙层，不阻断聊天；用户可拖动标题栏移动，关闭仅隐藏窗口，不取消工具执行。

模型每次对已有图执行 `edit_image` 时也自动显示窗口。若用户此前关闭过窗口，新一次编辑自动重新打开；编辑结束后窗口保持显示，方便用户检查结果。

### 4.2 用户框选与后续对话

用户在窗口工具栏选择“框选”，在图片上拖拽产生矩形选区。选区坐标以图像原始像素表示，和窗口缩放、设备像素比无关。窗口显示 `x, y, w, h`，并可清除选区或点击“全图”。

用户下一次发送普通聊天消息时，插件将最近一次选区作为本会话附加上下文注入模型；用户无需手工描述坐标。注入内容包括图像 ID、版本、原始宽高和选区边界。若该框选来自尚未提交的图像版本，则丢弃框选并提示用户重新选择。框选本身不发起模型调用，也不阻塞消息发送。

注入示例：

```text
[当前图像上下文]
imageId=image:main, version=17, size=1536x1024
用户已选择区域：rect(x=312, y=168, w=540, h=416)。
当用户说“这里”“选中区域”且未另行指定范围时，优先使用此区域；不得修改其外部像素。
```

### 4.3 工具记录与恢复显示

`create_image`、`edit_image`、`render_image` 和 `save_image` 的工具行右侧均显示“显示画面”。没有文档时按钮禁用；窗口显示时按钮显示“画面已显示”。点击按钮恢复当前会话最后一张图、当前缩放与最近选区，且不触发模型调用。工具行和弹窗遵循 `gomoku` 的无蒙层、可拖动、可恢复模式，但不需要等待用户作答。

### 4.4 保存

窗口提供“保存 PNG”按钮；`save_image` 也可由模型在用户明确要求保存时调用。浏览器将当前已提交版本编码为 PNG 后触发下载，文件名默认为 `ai-drawing-YYYYMMDD-HHmmss.png`，可指定安全的基础名称。保存不改变文档、选区或历史，也不把本地文件路径返回模型。

## 5. 状态模型

每个 Agent session 只有一个 `ImageDocument`。客户端编辑器是文档与预览的唯一真源；Host 通过 session-scoped bridge 调用，不维护第二份可变像素状态。

```ts
interface ImageDocument {
  id: 'image:main'
  width: number
  height: number
  version: number
  tiles: Map<TileId, RasterTile> // 256 × 256，边缘 tile 可较小
  selection: RectSelection | null
  undoStack: HistoryEntry[]
  redoStack: HistoryEntry[]
}
```

图片逻辑上是一张 RGBA 位图；tile 只是渲染、回滚和存储优化，不对模型暴露。`HistoryEntry` 记录受影响 tile 的前后数据或可逆补丁。每个成功的创建、编辑、撤销或重做递增 `version`。导出、查询、渲染和选区上下文均携带版本，防止模型依据陈旧截图修改新图。

首版限制一张最大 4096 × 4096 的图、单次操作最多 64 个受影响 tile、单次历史数据与 PNG 导出均有大小上限；超限时返回可操作错误。

## 6. 模型工具契约

### 6.1 `query_image`

读取结构化状态，不返回原始像素。

```ts
query_image({
  scope: 'summary' | 'selection' | 'region',
  bounds?: { x: number, y: number, w: number, h: number },
})
```

返回 `imageId`、`version`、尺寸、当前选区、透明度统计、请求区域和裁剪提示。模型需要视觉判断时应调用 `render_image`，而非根据坐标猜测画面。

### 6.2 `create_image`

创建并替换当前唯一图像。已有图像时必须显式传入 `replace: true`，否则拒绝，避免误覆盖。

```ts
create_image({
  width: 1536,
  height: 1024,
  background: 'transparent' | '#ffffff',
  replace?: true,
})
```

成功后自动显示窗口并返回初始版本、尺寸和文档 ID。

### 6.3 `edit_image`

以一次事务提交绘制、精确像素处理或 AI 图像编辑。所有坐标均为文档内在像素坐标；几何坐标按统一规则取整并裁剪至画面边界。

```ts
edit_image({
  expectedVersion: 17,
  selection: { type: 'all' },
  ops: [
    { op: 'fill', color: '#1d4ed8', opacity: 1, blendMode: 'source-over' },
    { op: 'brush', points: [{ x: 10, y: 20 }, { x: 45, y: 60 }], radius: 8, color: '#fff', opacity: 0.8, hardness: 0.9 },
    { op: 'inpaint', prompt: '将选区中的天空变为黄昏', strength: 0.65 }
  ],
})
```

`selection` 支持：

- `{ type: 'all' }`：全图。只有用户明确要求全图时模型才能使用。
- `{ type: 'rect', x, y, w, h }`：矩形区域。
- `{ type: 'current' }`：客户端当前框选；无有效选区时拒绝。
- `{ type: 'mask', maskId }`：由系统创建的已验证 mask，不接受模型提交的二进制 mask。
- `{ type: 'color_range', seed: { x, y }, tolerance, contiguous }`：魔棒式选区。

允许的 `ops`：

- 几何绘制：`brush`、`line`、`rect`、`ellipse`、`polygon`、`text`。
- 像素编辑：`fill`、`clear`、`flood_fill`、`replace_color`。
- 图像调整：`crop`、`resize`、`rotate`、`flip`、`adjust`、`blur`、`sharpen`。
- AI 编辑：`generate`（仅空白图或全图）、`inpaint`（必须有 `current`、`rect` 或 `mask` 选区）、`outpaint`（扩展画布时使用）。

除 `crop`、`resize` 与 `outpaint` 外，所有操作默认限制在 `selection` 内；AI 操作获得结果后也只将 mask 覆盖范围合成回原图。模型不可提交 Base64、URL、文件路径、表达式、Canvas 代码或任意 blend/filter 名称；样式、混合模式和滤镜均为白名单 token。

### 6.4 `render_image`

返回当前整图或指定区域的 PNG，供模型进行视觉核验。

```ts
render_image({
  expectedVersion?: number,
  bounds?: { x: number, y: number, w: number, h: number },
  scale?: number,
})
```

工具限制输出像素面积，并返回实际渲染边界和版本。大图默认返回适合观察的缩略图；模型需观察细节时指定区域，而不是无限提高 scale。

### 6.5 `save_image`

仅在用户明确要求下载/保存图片时调用。

```ts
save_image({
  expectedVersion: 18,
  filename?: 'sunset-beach.png',
})
```

客户端使用当前已提交版本生成并下载 PNG；文件名会被清洗，强制使用 `.png`。返回导出版本和文件名，不返回文件系统位置。

### 6.6 `undo_image` / `redo_image`

```ts
undo_image({ expectedVersion: 18 })
redo_image({ expectedVersion: 19 })
```

每次只回退或恢复一个原子事务。用户在窗口中触发的撤销/重做与模型工具共享同一历史。

## 7. 客户端交互与实时渲染

绘图窗口为 `position: fixed` 的独立浮层，初次在视口居中，后续记住当前会话内的拖动位置，并保证始终留有 8px 可见边距。标题栏是唯一拖动手柄；按钮、工具栏、画布和选择控制不触发拖动。窗口包含：

1. 标题栏：图像名称、尺寸、版本、执行状态、关闭按钮。
2. 工具栏：平移、框选、清除选区、全图、适应窗口、缩小/放大、撤销、重做、保存 PNG。
3. 画布：棋盘格透明背景、平移缩放、当前图像、选区遮罩与边界。
4. 状态栏：执行进度、当前选区坐标、最近一次错误或保存结果。

每次编辑开始后 bridge 发布 `drawing-started`；处理 tile 时发布经过节流的 `drawing-progress`（进度、已写 tile、预览版本）；提交后发布 `drawing-committed`。客户端只展示已完整写入的 tile，取消、超时或失败时恢复提交前版本，不展示半成品为最终结果。

## 8. 内部执行与安全

`edit_image` 的执行顺序：

```text
校验 document 存在、expectedVersion、schema 与资源上限
  → 解析并裁剪选区为 alpha mask
  → 计算受影响 tiles，建立事务快照
  → Worker 中用 OffscreenCanvas 绘制；逐像素操作使用 ImageData/Uint8ClampedArray
  → AI 操作：发送裁剪图 + mask + prompt，结果仅合成回 mask 范围
  → 编码变更 tile，原子替换、写入历史、version + 1
  → 发布实时预览与最终结果
```

任意一步失败或取消均丢弃事务，不改变版本、像素或历史。Host 强制校验对象数量、文本长度、坐标、颜色、操作数、tile 数、截图面积和 AI 请求大小。跨域图片、任意 URL、文件路径和脚本均不进入 Canvas，避免污染画布和越权读取。

## 9. 模型行为规范

1. 创建前先检查是否已有图像；替换必须得到用户明确授权。
2. 编辑前调用 `query_image`；涉及视觉位置、颜色或细节时调用 `render_image`。
3. 用户已框选区域且说“这里”“选中部分”时，优先 `selection: { type: 'current' }`，不得扩大范围。
4. 仅在用户明确说“整张图”“全图”时用 `selection: { type: 'all' }`。
5. 多操作作为一个小批次原子提交；复杂 AI 重绘后调用 `render_image`，最多执行一次针对性修复。
6. 保存仅响应用户明确的“保存”“下载”“导出”意图。

## 10. 验收标准

1. 模型首次创建图片时，可移动浮窗立即出现并显示尺寸与实时进度；关闭后下一次编辑会重新打开。
2. 在 1536 × 1024 图像中，模型对 `(100, 200, 300, 400)` 矩形的填充只改变该范围内像素，范围外哈希不变。
3. 用户框选 `(312, 168, 540, 416)` 后发送“把这里改成夜景”，下一次模型上下文包含同版本、同坐标的选区信息，模型操作使用 `current` 选区。
4. 用户点击任一相关工具行的“显示画面”可恢复窗口、当前图像与选区；不产生新的工具调用。
5. `expectedVersion` 过期、无 `current` 选区或任一批量操作非法时，整个事务被拒绝，版本和像素不变。
6. 用户和模型都可撤销、重做对方的上一次原子操作。
7. 用户点击“保存 PNG”或模型响应明确保存请求调用 `save_image` 后，浏览器下载可打开的 PNG，像素与导出版本一致。
8. AI `inpaint` 的合成后，mask 外的像素哈希不变。

## 11. 实施里程碑

1. 建立 `ImageDocument`、tile、版本和历史模型，替换现有 tldraw 相关描述。
2. 实现 Canvas/OffscreenCanvas bridge、可移动绘图窗口、实时预览和工具行“显示画面”。
3. 实现框选、缩放平移及下一条用户消息的选区上下文注入。
4. 实现 `query_image`、`create_image`、基础 `edit_image`、`render_image` 与事务测试。
5. 接入 AI 生成、选区 inpaint/outpaint、取消与进度事件。
6. 实现共享撤销/重做、PNG 保存、视觉回归、协议测试和文档。
