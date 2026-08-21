export const MAX_DIMENSION = 4096
export const MAX_PIXELS = MAX_DIMENSION * MAX_DIMENSION
export const MAX_OPS = 32

export interface Rect { x: number; y: number; w: number; h: number }
export interface Selection extends Rect { type: 'rect' }
export interface ImageDocument {
  id: 'image:main'
  width: number
  height: number
  version: number
  pixels: Uint8ClampedArray
  selection: Selection | null
  undoStack: HistoryEntry[]
  redoStack: HistoryEntry[]
}

interface HistoryEntry { pixels: Uint8ClampedArray; width: number; height: number; selection: Selection | null }
export type EditOperation =
  | { op: 'fill'; color: string; opacity?: number }
  | { op: 'clear' }
  | { op: 'rect'; x: number; y: number; w: number; h: number; color: string; opacity?: number }
  | { op: 'ellipse'; x: number; y: number; w: number; h: number; color: string; opacity?: number }
  | { op: 'polygon'; points: Array<{ x: number; y: number }>; color: string; opacity?: number }
  | { op: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; radius?: number; opacity?: number }
  | { op: 'brush'; points: Array<{ x: number; y: number }>; color: string; radius?: number; opacity?: number }
  | { op: 'replace_color'; from: string; to: string; tolerance?: number }
  | { op: 'flood_fill'; x: number; y: number; color: string; tolerance?: number; opacity?: number }
  | { op: 'crop'; x: number; y: number; w: number; h: number }
  | { op: 'resize'; width: number; height: number }
  | { op: 'flip'; axis: 'horizontal' | 'vertical' }

export class DrawingError extends Error {}

export function createDocument(width: number, height: number, background: 'transparent' | string): ImageDocument {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
    throw new DrawingError(`image dimensions must be integers between 1 and ${MAX_DIMENSION}`)
  }
  const pixels = new Uint8ClampedArray(width * height * 4)
  if (background !== 'transparent') fillPixels(pixels, parseColor(background), 1)
  return { id: 'image:main', width, height, version: 1, pixels, selection: null, undoStack: [], redoStack: [] }
}

export function normalizeRect(input: Rect, doc: Pick<ImageDocument, 'width' | 'height'>): Rect {
  const x = Math.max(0, Math.min(doc.width, Math.floor(input.x)))
  const y = Math.max(0, Math.min(doc.height, Math.floor(input.y)))
  const right = Math.max(x, Math.min(doc.width, Math.ceil(input.x + input.w)))
  const bottom = Math.max(y, Math.min(doc.height, Math.ceil(input.y + input.h)))
  if (!Number.isFinite(input.x) || !Number.isFinite(input.y) || !Number.isFinite(input.w) || !Number.isFinite(input.h) || input.w <= 0 || input.h <= 0 || right === x || bottom === y) throw new DrawingError('selection must be a non-empty rectangle')
  return { x, y, w: right - x, h: bottom - y }
}

export function setSelection(doc: ImageDocument, selection: Rect | null): void {
  doc.selection = selection === null ? null : { type: 'rect', ...normalizeRect(selection, doc) }
}

export function edit(doc: ImageDocument, selection: Rect, ops: EditOperation[]): void {
  if (ops.length === 0 || ops.length > MAX_OPS) throw new DrawingError(`ops must contain 1 to ${MAX_OPS} operations`)
  const before = snapshot(doc)
  const target = normalizeRect(selection, doc)
  try {
    for (const op of ops) applyOperation(doc, target, op)
  } catch (error) {
    restore(doc, before)
    throw error
  }
  doc.undoStack.push(before)
  doc.redoStack = []
  doc.version++
}

export function undo(doc: ImageDocument): void {
  const previous = doc.undoStack.pop()
  if (previous === undefined) throw new DrawingError('nothing to undo')
  doc.redoStack.push(snapshot(doc)); restore(doc, previous); doc.version++
}

export function redo(doc: ImageDocument): void {
  const next = doc.redoStack.pop()
  if (next === undefined) throw new DrawingError('nothing to redo')
  doc.undoStack.push(snapshot(doc)); restore(doc, next); doc.version++
}

export function alphaStats(doc: ImageDocument, area: Rect): { opaque: number; transparent: number; partial: number } {
  const rect = normalizeRect(area, doc); let opaque = 0; let transparent = 0; let partial = 0
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
    const alpha = doc.pixels[(y * doc.width + x) * 4 + 3]!
    if (alpha === 0) transparent++; else if (alpha === 255) opaque++; else partial++
  }
  return { opaque, transparent, partial }
}

function snapshot(doc: ImageDocument): HistoryEntry { return { pixels: doc.pixels.slice(), width: doc.width, height: doc.height, selection: doc.selection === null ? null : { ...doc.selection } } }
function restore(doc: ImageDocument, state: HistoryEntry): void { doc.pixels = state.pixels; doc.width = state.width; doc.height = state.height; doc.selection = state.selection }
function parseColor(input: string): [number, number, number, number] {
  const match = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(input)
  if (match === null) throw new DrawingError('colors must be #RRGGBB or #RRGGBBAA')
  const hex = match[1]!
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255]
}
function opacity(value: number | undefined): number { if (value === undefined) return 1; if (!Number.isFinite(value) || value < 0 || value > 1) throw new DrawingError('opacity must be between 0 and 1'); return value }
function fillPixels(pixels: Uint8ClampedArray, color: [number, number, number, number], alpha: number): void { for (let i = 0; i < pixels.length; i += 4) blend(pixels, i, color, alpha) }
function blend(pixels: Uint8ClampedArray, i: number, color: [number, number, number, number], alpha: number): void { const a = color[3] * alpha / 255; const old = pixels[i + 3]! / 255; const out = a + old * (1 - a); if (out === 0) { pixels.fill(0, i, i + 4); return } for (let c = 0; c < 3; c++) pixels[i + c] = (color[c]! * a + pixels[i + c]! * old * (1 - a)) / out; pixels[i + 3] = out * 255 }
function applyOperation(doc: ImageDocument, target: Rect, op: EditOperation): void {
  if (op.op === 'crop') { crop(doc, normalizeRect(op, doc)); return }
  if (op.op === 'resize') { resize(doc, op.width, op.height); return }
  if (op.op === 'flip') { flip(doc, op.axis); return }
  if (op.op === 'fill') { forRect(target, (x, y) => paint(doc, x, y, parseColor(op.color), opacity(op.opacity))); return }
  if (op.op === 'clear') { forRect(target, (x, y) => clear(doc, x, y)); return }
  if (op.op === 'rect') { const rect = intersect(target, normalizeRect(op, doc)); forRect(rect, (x, y) => paint(doc, x, y, parseColor(op.color), opacity(op.opacity))); return }
  if (op.op === 'ellipse') { const rect = intersect(target, normalizeRect(op, doc)); const rx = rect.w / 2; const ry = rect.h / 2; const cx = rect.x + rx; const cy = rect.y + ry; const color = parseColor(op.color); forRect(rect, (x, y) => { if (((x + .5 - cx) / rx) ** 2 + ((y + .5 - cy) / ry) ** 2 <= 1) paint(doc, x, y, color, opacity(op.opacity)) }); return }
  if (op.op === 'polygon') { if (op.points.length < 3 || op.points.length > 128) throw new DrawingError('polygon points must contain 3 to 128 coordinates'); const color = parseColor(op.color); const xs = op.points.map(point => point.x); const ys = op.points.map(point => point.y); const box = intersect(target, normalizeRect({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs) + 1, h: Math.max(...ys) - Math.min(...ys) + 1 }, doc)); forRect(box, (x, y) => { if (insidePolygon(x + .5, y + .5, op.points)) paint(doc, x, y, color, opacity(op.opacity)) }); return }
  if (op.op === 'flood_fill') { floodFill(doc, target, op); return }
  if (op.op === 'replace_color') { const from = parseColor(op.from); const to = parseColor(op.to); const tolerance = op.tolerance ?? 0; if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 255) throw new DrawingError('tolerance must be between 0 and 255'); forRect(target, (x, y) => { const i = (y * doc.width + x) * 4; if ([0, 1, 2, 3].every(c => Math.abs(doc.pixels[i + c]! - from[c]!) <= tolerance)) blend(doc.pixels, i, to, 1) }); return }
  const color = parseColor(op.color); const radius = op.radius ?? 1; if (!Number.isFinite(radius) || radius <= 0 || radius > 512) throw new DrawingError('radius must be between 0 and 512')
  if (op.op === 'brush') { if (op.points.length === 0 || op.points.length > 1024) throw new DrawingError('brush points must contain 1 to 1024 coordinates'); for (const point of op.points) dot(doc, target, point.x, point.y, radius, color, opacity(op.opacity)); return }
  const dx = op.x2 - op.x1; const dy = op.y2 - op.y1; const steps = Math.max(Math.abs(dx), Math.abs(dy), 1)
  for (let i = 0; i <= steps; i++) dot(doc, target, op.x1 + dx * i / steps, op.y1 + dy * i / steps, radius, color, opacity(op.opacity))
}
function insidePolygon(x: number, y: number, points: Array<{ x: number; y: number }>): boolean { let inside = false; for (let i = 0, j = points.length - 1; i < points.length; j = i++) { const a = points[i]!; const b = points[j]!; if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside } return inside }
function floodFill(doc: ImageDocument, target: Rect, op: Extract<EditOperation, { op: 'flood_fill' }>): void { const x = Math.floor(op.x); const y = Math.floor(op.y); if (x < target.x || y < target.y || x >= target.x + target.w || y >= target.y + target.h) throw new DrawingError('flood fill seed must be inside the selection'); const tolerance = op.tolerance ?? 0; if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 255) throw new DrawingError('tolerance must be between 0 and 255'); const index = (y * doc.width + x) * 4; const source: [number, number, number, number] = [doc.pixels[index]!, doc.pixels[index + 1]!, doc.pixels[index + 2]!, doc.pixels[index + 3]!]; const color = parseColor(op.color); const visited = new Uint8Array(target.w * target.h); const queue: Array<[number, number]> = [[x, y]]; for (let cursor = 0; cursor < queue.length; cursor++) { const [px, py] = queue[cursor]!; const key = (py - target.y) * target.w + px - target.x; if (visited[key] !== 0) continue; visited[key] = 1; const current = (py * doc.width + px) * 4; if ([0, 1, 2, 3].some(c => Math.abs(doc.pixels[current + c]! - source[c]!) > tolerance)) continue; paint(doc, px, py, color, opacity(op.opacity)); if (px > target.x) queue.push([px - 1, py]); if (px + 1 < target.x + target.w) queue.push([px + 1, py]); if (py > target.y) queue.push([px, py - 1]); if (py + 1 < target.y + target.h) queue.push([px, py + 1]) } }
function crop(doc: ImageDocument, rect: Rect): void { const next = new Uint8ClampedArray(rect.w * rect.h * 4); for (let y = 0; y < rect.h; y++) next.set(doc.pixels.subarray(((rect.y + y) * doc.width + rect.x) * 4, ((rect.y + y) * doc.width + rect.x + rect.w) * 4), y * rect.w * 4); doc.width = rect.w; doc.height = rect.h; doc.pixels = next; doc.selection = null }
function resize(doc: ImageDocument, width: number, height: number): void { if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) throw new DrawingError(`resize dimensions must be integers between 1 and ${MAX_DIMENSION}`); const next = new Uint8ClampedArray(width * height * 4); for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const sx = Math.min(doc.width - 1, Math.floor(x * doc.width / width)); const sy = Math.min(doc.height - 1, Math.floor(y * doc.height / height)); next.set(doc.pixels.subarray((sy * doc.width + sx) * 4, (sy * doc.width + sx) * 4 + 4), (y * width + x) * 4) } doc.width = width; doc.height = height; doc.pixels = next; doc.selection = null }
function flip(doc: ImageDocument, axis: 'horizontal' | 'vertical'): void { const next = new Uint8ClampedArray(doc.pixels.length); for (let y = 0; y < doc.height; y++) for (let x = 0; x < doc.width; x++) { const sx = axis === 'horizontal' ? doc.width - 1 - x : x; const sy = axis === 'vertical' ? doc.height - 1 - y : y; next.set(doc.pixels.subarray((sy * doc.width + sx) * 4, (sy * doc.width + sx) * 4 + 4), (y * doc.width + x) * 4) } doc.pixels = next }
function dot(doc: ImageDocument, target: Rect, cx: number, cy: number, radius: number, color: [number, number, number, number], alpha: number): void { const box = intersect(target, { x: Math.floor(cx - radius), y: Math.floor(cy - radius), w: Math.ceil(radius * 2 + 1), h: Math.ceil(radius * 2 + 1) }); forRect(box, (x, y) => { if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) paint(doc, x, y, color, alpha) }) }
function paint(doc: ImageDocument, x: number, y: number, color: [number, number, number, number], alpha: number): void { blend(doc.pixels, (y * doc.width + x) * 4, color, alpha) }
function clear(doc: ImageDocument, x: number, y: number): void { doc.pixels.fill(0, (y * doc.width + x) * 4, (y * doc.width + x) * 4 + 4) }
function forRect(rect: Rect, fn: (x: number, y: number) => void): void { for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) fn(x, y) }
function intersect(a: Rect, b: Rect): Rect { const x = Math.max(a.x, b.x); const y = Math.max(a.y, b.y); const right = Math.min(a.x + a.w, b.x + b.w); const bottom = Math.min(a.y + a.h, b.y + b.h); return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) } }
