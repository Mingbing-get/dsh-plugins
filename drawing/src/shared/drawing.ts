/** Shared drawing protocol types used by both plugin runtimes. */
// The public protocol intentionally uses a namespace so consumers can use Drawing.Rect, Drawing.EditOperation, etc.
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Drawing {
  export type Color = string
  export type ToolName = 'create_image' | 'query_image' | 'edit_image' | 'undo_image' | 'redo_image'
  export type Selection = AllSelection | CurrentSelection | RectSelection
  export type EditOperation =
    | FillOperation
    | ClearOperation
    | LinearGradientOperation
    | RadialGradientOperation
    | RectOperation
    | EllipseOperation
    | PolygonOperation
    | LineOperation
    | BrushOperation
    | ReplaceColorOperation
    | FloodFillOperation
    | CropOperation
    | ResizeOperation
    | FlipOperation

  export interface Point {
    x: number
    y: number
  }
  export interface Rect {
    x: number
    y: number
    w: number
    h: number
  }
  export interface RectSelection extends Rect {
    type: 'rect'
  }
  export interface AllSelection {
    type: 'all'
  }
  export interface CurrentSelection {
    type: 'current'
  }
  export interface ImageInfo {
    imageId: string
    version: number
    width: number
    height: number
    selection: RectSelection | null
  }
  export interface ImageResult extends ImageInfo {
    bounds: Rect
    alpha: AlphaStats
    clipped: boolean
  }
  export interface AlphaStats {
    opaque: number
    transparent: number
    partial: number
  }
  export interface CreateImageArguments {
    width: number
    height: number
    background?: 'transparent' | Color
    replace?: boolean
  }
  export interface QueryImageArguments {
    scope: 'summary' | 'selection' | 'region'
    bounds?: Rect
  }
  export interface EditImageArguments {
    expectedVersion: number
    selection: Selection
    ops: EditOperation[]
  }
  export interface VersionedImageArguments {
    expectedVersion: number
  }
  export interface FillOperation {
    op: 'fill'
    color: Color
    opacity?: number
  }
  export interface ClearOperation {
    op: 'clear'
  }
  export interface LinearGradientOperation extends GradientOperation {
    op: 'linear_gradient'
    x1: number
    y1: number
    x2: number
    y2: number
  }
  export interface RadialGradientOperation extends GradientOperation {
    op: 'radial_gradient'
    cx: number
    cy: number
    radius: number
  }
  export interface GradientOperation {
    colors: GradientColorStop[]
    opacity?: number
  }
  export interface GradientColorStop {
    color: Color
    offset: `${number}%`
  }
  export interface ShapeStyle {
    /** Fill color. Omit to draw an outline only. */
    fill?: Color
    /** Outline color. Omit to draw a filled shape only. */
    stroke?: Color
    /** Outline width in pixels. Defaults to 1 when stroke is set. */
    strokeWidth?: number
  }
  export interface RectOperation extends Rect, ShapeStyle {
    op: 'rect'
    opacity?: number
  }
  export interface EllipseOperation extends Rect, ShapeStyle {
    op: 'ellipse'
    opacity?: number
  }
  export interface PolygonOperation extends ShapeStyle {
    op: 'polygon'
    points: Point[]
    opacity?: number
  }
  export interface LineOperation {
    op: 'line'
    x1: number
    y1: number
    x2: number
    y2: number
    color: Color
    radius?: number
    opacity?: number
  }
  export interface BrushOperation {
    op: 'brush'
    points: Point[]
    color: Color
    radius?: number
    opacity?: number
  }
  export interface ReplaceColorOperation {
    op: 'replace_color'
    from: Color
    to: Color
    tolerance?: number
  }
  export interface FloodFillOperation extends Point {
    op: 'flood_fill'
    color: Color
    tolerance?: number
    opacity?: number
  }
  export interface CropOperation extends Rect {
    op: 'crop'
  }
  export interface ResizeOperation {
    op: 'resize'
    width: number
    height: number
  }
  export interface FlipOperation {
    op: 'flip'
    axis: 'horizontal' | 'vertical'
  }
}
