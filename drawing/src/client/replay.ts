import {
  createDocument,
  edit,
  redo,
  undo,
  type EditOperation,
  type ImageDocument,
  type Rect,
} from '../raster.ts'
import type { ConversationNode, ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'

export interface DrawingCommand {
  toolName: 'create_image' | 'edit_image' | 'undo_image' | 'redo_image'
  rawArguments: string
}

function argsOf(raw: string): any {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
function preview(doc: ImageDocument): string {
  const canvas = window.document.createElement('canvas')
  canvas.width = doc.width
  canvas.height = doc.height
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('Canvas 2D is unavailable')
  const pixels = new Uint8ClampedArray(doc.pixels.length)
  pixels.set(doc.pixels)
  context.putImageData(new ImageData(pixels, doc.width, doc.height), 0, 0)
  return canvas.toDataURL('image/png')
}

/** Rebuild the preview in committed-version order, independent of React mount order. */
export function replayDrawingHistory(commands: Record<number, DrawingCommand>): string | null {
  let document: ImageDocument | null = null
  for (const command of Object.entries(commands)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, value]) => value)) {
    const args = argsOf(command.rawArguments)
    if (args === null) continue
    try {
      if (command.toolName === 'create_image')
        document = createDocument(args.width, args.height, args.background ?? 'transparent')
      else if (command.toolName === 'edit_image' && document !== null) {
        const selection = args.selection
        const area: Rect | null =
          selection?.type === 'all'
            ? { x: 0, y: 0, w: document.width, h: document.height }
            : selection?.type === 'rect'
              ? selection
              : selection?.type === 'current'
                ? document.selection
                : null
        if (area === null) continue
        edit(document, area, args.ops as EditOperation[])
      } else if (command.toolName === 'undo_image' && document !== null) undo(document)
      else if (command.toolName === 'redo_image' && document !== null) redo(document)
    } catch {
      return null
    }
  }
  if (document === null) return null
  return preview(document)
}

function isReplayable(name: string): name is DrawingCommand['toolName'] {
  return (
    name === 'create_image' ||
    name === 'edit_image' ||
    name === 'undo_image' ||
    name === 'redo_image'
  )
}
function versionOf(block: ToolCallBlock): number | null {
  if (!('kind' in block)) return null
  if (typeof block.meta === 'object' && block.meta !== null && 'image' in block.meta) {
    const image = block.meta.image
    if (
      typeof image === 'object' &&
      image !== null &&
      'version' in image &&
      Number.isInteger(image.version)
    )
      return image.version as number
  }
  try {
    const value = JSON.parse(
      block.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join(''),
    ) as unknown
    return typeof value === 'object' &&
      value !== null &&
      'version' in value &&
      Number.isInteger(value.version)
      ? (value.version as number)
      : null
  } catch {
    return null
  }
}

/** Extract drawing calls from the authoritative session transcript, not mounted tool-row components. */
export function drawingHistoryFromNodes(
  nodes: readonly ConversationNode[],
): Record<number, DrawingCommand> {
  const commands: Record<number, DrawingCommand> = {}
  for (const node of nodes) {
    if (
      node.kind !== 'tool-result' ||
      node.isError ||
      node.call === null ||
      !isReplayable(node.call.name)
    )
      continue
    const version = versionOf(node)
    if (version !== null)
      commands[version] = { toolName: node.call.name, rawArguments: node.call.argsRaw }
  }
  return commands
}
