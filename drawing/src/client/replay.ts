import { createDocument, edit, redo, undo, type EditOperation, type ImageDocument, type Rect } from '../raster.ts'

let document: ImageDocument | null = null

function argsOf(raw: string): any { try { return JSON.parse(raw) } catch { return null } }
function preview(doc: ImageDocument): string {
  const canvas = window.document.createElement('canvas'); canvas.width = doc.width; canvas.height = doc.height
  const context = canvas.getContext('2d'); if (context === null) throw new Error('Canvas 2D is unavailable')
  const pixels = new Uint8ClampedArray(doc.pixels.length); pixels.set(doc.pixels)
  context.putImageData(new ImageData(pixels, doc.width, doc.height), 0, 0)
  return canvas.toDataURL('image/png')
}

/** Replay one successful persisted drawing command in the browser. */
export function replayDrawing(toolName: string, rawArguments: string): string | null {
  const args = argsOf(rawArguments); if (args === null) return null
  if (toolName === 'create_image') document = createDocument(args.width, args.height, args.background ?? 'transparent')
  else if (toolName === 'edit_image' && document !== null) {
    const selection = args.selection
    const area: Rect | null = selection?.type === 'all' ? { x: 0, y: 0, w: document.width, h: document.height }
      : selection?.type === 'rect' ? selection : selection?.type === 'current' ? document.selection : null
    if (area === null) return null
    edit(document, area, args.ops as EditOperation[])
  } else if (toolName === 'undo_image' && document !== null) undo(document)
  else if (toolName === 'redo_image' && document !== null) redo(document)
  else return null
  return preview(document)
}
