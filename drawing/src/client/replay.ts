import type { Drawing } from '../shared/drawing.ts'
import type { DrawingCall } from './store.ts'

type Canvas = HTMLCanvasElement
type Context = CanvasRenderingContext2D
type EditOperation = Drawing.EditOperation

interface ImageDocument {
  canvas: Canvas
  context: Context
}

interface EditBatch {
  operations: EditOperation[]
  selection: unknown
}

function parseArgs(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function alpha(context: Context, value: unknown): void {
  context.globalAlpha = typeof value === 'number' && Number.isFinite(value) ? value : 1
}

function selection(context: Context, value: unknown): void {
  if (typeof value !== 'object' || value === null || (value as { type?: unknown }).type !== 'rect')
    return
  const rect = value as Drawing.RectSelection
  context.beginPath()
  context.rect(rect.x, rect.y, rect.w, rect.h)
  context.clip()
}

function stops(gradient: CanvasGradient, colors: unknown): void {
  if (!Array.isArray(colors)) return
  for (const stop of colors) {
    if (typeof stop !== 'object' || stop === null) continue
    const { color, offset } = stop as { color?: unknown; offset?: unknown }
    if (typeof color !== 'string' || typeof offset !== 'string') continue
    const ratio = Number.parseFloat(offset) / 100
    if (Number.isFinite(ratio)) gradient.addColorStop(Math.max(0, Math.min(1, ratio)), color)
  }
}

function drawPath(context: Context, points: Drawing.Point[]): void {
  const first = points[0]
  if (first === undefined) return
  context.beginPath()
  context.moveTo(first.x, first.y)
  for (const point of points.slice(1)) context.lineTo(point.x, point.y)
}

function drawOperation(
  document: ImageDocument,
  operation: EditOperation,
  selectionValue: unknown,
): ImageDocument {
  let { canvas, context } = document
  context.save()
  selection(context, selectionValue)
  alpha(context, (operation as { opacity?: unknown }).opacity)
  switch (operation.op) {
    case 'fill':
      context.fillStyle = operation.color
      context.fillRect(0, 0, canvas.width, canvas.height)
      break
    case 'clear':
      context.clearRect(0, 0, canvas.width, canvas.height)
      break
    case 'linear_gradient': {
      const gradient = context.createLinearGradient(
        operation.x1,
        operation.y1,
        operation.x2,
        operation.y2,
      )
      stops(gradient, operation.colors)
      context.fillStyle = gradient
      context.fillRect(0, 0, canvas.width, canvas.height)
      break
    }
    case 'radial_gradient': {
      const gradient = context.createRadialGradient(
        operation.cx,
        operation.cy,
        0,
        operation.cx,
        operation.cy,
        operation.radius,
      )
      stops(gradient, operation.colors)
      context.fillStyle = gradient
      context.fillRect(0, 0, canvas.width, canvas.height)
      break
    }
    case 'rect':
      if (operation.fill !== undefined) {
        context.fillStyle = operation.fill
        context.fillRect(operation.x, operation.y, operation.w, operation.h)
      }
      if (operation.stroke !== undefined) {
        context.strokeStyle = operation.stroke
        context.lineWidth = operation.strokeWidth ?? 1
        context.strokeRect(operation.x, operation.y, operation.w, operation.h)
      }
      break
    case 'ellipse':
      context.beginPath()
      context.ellipse(
        operation.x + operation.w / 2,
        operation.y + operation.h / 2,
        Math.abs(operation.w / 2),
        Math.abs(operation.h / 2),
        0,
        0,
        Math.PI * 2,
      )
      if (operation.fill !== undefined) {
        context.fillStyle = operation.fill
        context.fill()
      }
      if (operation.stroke !== undefined) {
        context.strokeStyle = operation.stroke
        context.lineWidth = operation.strokeWidth ?? 1
        context.stroke()
      }
      break
    case 'polygon':
      drawPath(context, operation.points)
      context.closePath()
      if (operation.fill !== undefined) {
        context.fillStyle = operation.fill
        context.fill()
      }
      if (operation.stroke !== undefined) {
        context.strokeStyle = operation.stroke
        context.lineWidth = operation.strokeWidth ?? 1
        context.stroke()
      }
      break
    case 'line':
      context.beginPath()
      context.moveTo(operation.x1, operation.y1)
      context.lineTo(operation.x2, operation.y2)
      context.strokeStyle = operation.color
      context.lineWidth = (operation.radius ?? 1) * 2
      context.lineCap = 'round'
      context.stroke()
      break
    case 'brush':
      drawPath(context, operation.points)
      context.strokeStyle = operation.color
      context.lineWidth = (operation.radius ?? 1) * 2
      context.lineCap = 'round'
      context.lineJoin = 'round'
      context.stroke()
      break
    case 'flood_fill':
      context.fillStyle = operation.color
      context.beginPath()
      context.arc(operation.x, operation.y, Math.max(1, operation.tolerance ?? 1), 0, Math.PI * 2)
      context.fill()
      break
    case 'replace_color':
      replaceColor(context, canvas, operation.from, operation.to, operation.tolerance ?? 0)
      break
    case 'resize':
      ;({ canvas, context } = resize(document, operation.width, operation.height))
      break
    case 'crop':
      ;({ canvas, context } = crop(document, operation.x, operation.y, operation.w, operation.h))
      break
    case 'flip':
      flip(context, canvas, operation.axis)
      break
  }
  context.restore()
  return { canvas, context }
}

function resize(document: ImageDocument, width: number, height: number): ImageDocument {
  const next = document.canvas.ownerDocument.createElement('canvas')
  next.width = width
  next.height = height
  const context = next.getContext('2d')!
  context.drawImage(document.canvas, 0, 0, width, height)
  return { canvas: next, context }
}

function crop(
  document: ImageDocument,
  x: number,
  y: number,
  width: number,
  height: number,
): ImageDocument {
  const next = document.canvas.ownerDocument.createElement('canvas')
  next.width = width
  next.height = height
  const context = next.getContext('2d')!
  context.drawImage(document.canvas, x, y, width, height, 0, 0, width, height)
  return { canvas: next, context }
}

function flip(context: Context, canvas: Canvas, axis: 'horizontal' | 'vertical'): void {
  const copy = canvas.ownerDocument.createElement('canvas')
  copy.width = canvas.width
  copy.height = canvas.height
  copy.getContext('2d')!.drawImage(canvas, 0, 0)
  context.save()
  context.setTransform(
    axis === 'horizontal' ? -1 : 1,
    0,
    0,
    axis === 'vertical' ? -1 : 1,
    axis === 'horizontal' ? canvas.width : 0,
    axis === 'vertical' ? canvas.height : 0,
  )
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.drawImage(copy, 0, 0)
  context.restore()
}

function hex(value: string): [number, number, number, number] | null {
  const raw = value.slice(1)
  if (!/^([0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw)) return null
  return [
    Number.parseInt(raw.slice(0, 2), 16),
    Number.parseInt(raw.slice(2, 4), 16),
    Number.parseInt(raw.slice(4, 6), 16),
    raw.length === 8 ? Number.parseInt(raw.slice(6, 8), 16) : 255,
  ]
}

function replaceColor(
  context: Context,
  canvas: Canvas,
  from: string,
  to: string,
  tolerance: number,
): void {
  const source = hex(from)
  const target = hex(to)
  if (source === null || target === null) return
  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  for (let index = 0; index < image.data.length; index += 4) {
    const match =
      Math.max(
        ...source.map((channel, offset) => Math.abs(image.data[index + offset]! - channel)),
      ) <= tolerance
    if (!match) continue
    target.forEach((channel, offset) => {
      image.data[index + offset] = channel
    })
  }
  context.putImageData(image, 0, 0)
}

/** Rebuild the visible document from every drawing tool call in chronological order. */
export function replayDrawing(
  canvas: Canvas,
  calls: readonly DrawingCall[],
): { width: number; height: number } | null {
  let document: ImageDocument | null = null
  let applied: EditBatch[] = []
  let redo: EditBatch[] = []
  for (const call of calls) {
    const args = parseArgs(call.argsRaw)
    if (args === null) continue
    if (call.name === 'create_image') {
      const width = number(args.width)
      const height = number(args.height)
      if (width <= 0 || height <= 0) continue
      const surface = canvas.ownerDocument.createElement('canvas')
      surface.width = width
      surface.height = height
      const context = surface.getContext('2d')!
      if (typeof args.background === 'string' && args.background !== 'transparent') {
        context.fillStyle = args.background
        context.fillRect(0, 0, width, height)
      }
      document = { canvas: surface, context }
      applied = []
      redo = []
    } else if (call.name === 'edit_image' && Array.isArray(args.ops)) {
      applied.push({ operations: args.ops as EditOperation[], selection: args.selection })
      redo = []
    } else if (call.name === 'undo_image' && applied.length > 0) {
      redo.push(applied.pop()!)
    } else if (call.name === 'redo_image' && redo.length > 0) {
      applied.push(redo.pop()!)
    }
  }
  if (document === null) return null
  for (const batch of applied) {
    for (const operation of batch.operations) {
      document = drawOperation(document, operation, batch.selection)
    }
  }
  canvas.width = document.canvas.width
  canvas.height = document.canvas.height
  canvas.getContext('2d')!.drawImage(document.canvas, 0, 0)
  return { width: canvas.width, height: canvas.height }
}
