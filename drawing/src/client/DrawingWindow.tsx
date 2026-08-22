import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent } from 'react'
import type { ConversationSnapshot, ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { replayDrawing } from './replay.ts'
import type { DrawingCall, DrawingToolName } from './store.ts'

interface DrawingWindowProps {
  useSession: ToolCallViewProps['useSession']
  inputActions: ToolCallViewProps['inputActions']
  draft: string
  onClose: () => void
}

interface Selection {
  x: number
  y: number
  width: number
  height: number
}

const MINIMUM_SELECTION_SIZE = 4

function selectionContext(selection: Selection): string {
  return `\n\n[图片圈选上下文：用户选中了当前图片中 x=${selection.x}、y=${selection.y}、宽=${selection.width}、高=${selection.height} 的矩形区域（单位：图片原始像素）。后续请求中“这里”“选中部分”等指代均指此区域；如需调用 edit_image 编辑该区域，请使用 selection: { type: "rect", x: ${selection.x}, y: ${selection.y}, w: ${selection.width}, h: ${selection.height} }。]`
}

function argsOf(block: ToolCallBlock): string | null {
  return 'kind' in block ? (block.call?.argsRaw ?? null) : block.argsRaw
}

function nameOf(block: ToolCallBlock): DrawingToolName | null {
  const name = 'kind' in block ? block.call?.name : block.name
  return name === 'create_image' ||
    name === 'query_image' ||
    name === 'edit_image' ||
    name === 'undo_image' ||
    name === 'redo_image'
    ? name
    : null
}

function collectCalls(block: ToolCallBlock, calls: Map<string, DrawingCall>): void {
  const name = nameOf(block)
  const argsRaw = argsOf(block)
  if (name !== null && name !== 'query_image' && argsRaw !== null) {
    calls.set(block.callId, {
      id: block.callId,
      name,
      argsRaw,
      time: 'kind' in block ? (block.callTime ?? block.time) : block.time,
    })
  }
  for (const child of block.subCalls) collectCalls(child, calls)
}

export function drawingCalls(snapshot: ConversationSnapshot): DrawingCall[] {
  const indexed = new Map<string, DrawingCall>()
  for (const node of snapshot.nodes) if (node.kind === 'tool-result') collectCalls(node, indexed)
  for (const running of snapshot.runningCalls) collectCalls(running, indexed)
  return [...indexed.values()].sort((left, right) => left.time - right.time)
}

export function DrawingWindow({ useSession, inputActions, draft, onClose }: DrawingWindowProps) {
  const callsCache = useRef<{ lastCallId: string | null; calls: readonly DrawingCall[] }>({
    lastCallId: null,
    calls: [],
  })
  const calls = useSession((snapshot) => {
    const nextCalls = drawingCalls(snapshot)
    const lastCallId = nextCalls.at(-1)?.id ?? null
    if (callsCache.current.lastCallId === lastCallId) return callsCache.current.calls
    callsCache.current = { lastCallId, calls: nextCalls }
    return nextCalls
  })
  const canvas = useRef<HTMLCanvasElement>(null)
  const selectionOrigin = useRef<{ x: number; y: number } | null>(null)
  const dragOrigin = useRef<{ x: number; y: number; pointerX: number; pointerY: number } | null>(
    null,
  )
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [selection, setSelection] = useState<Selection | null>(null)
  useEffect(() => {
    if (canvas.current === null) return
    setSize(replayDrawing(canvas.current, calls))
  }, [calls])

  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    if (
      event.button !== 0 ||
      event.target instanceof HTMLButtonElement ||
      event.target instanceof HTMLCanvasElement
    )
      return
    dragOrigin.current = {
      x: position.x,
      y: position.y,
      pointerX: event.clientX,
      pointerY: event.clientY,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    const origin = dragOrigin.current
    if (origin === null) return
    setPosition({
      x: origin.x + event.clientX - origin.pointerX,
      y: origin.y + event.clientY - origin.pointerY,
    })
  }

  const handlePointerEnd = () => {
    dragOrigin.current = null
  }

  const pointInCanvas = (event: PointerEvent<HTMLCanvasElement>) => {
    const element = event.currentTarget
    const bounds = element.getBoundingClientRect()
    return {
      x: Math.round(((event.clientX - bounds.left) * element.width) / bounds.width),
      y: Math.round(((event.clientY - bounds.top) * element.height) / bounds.height),
    }
  }

  const handleSelectionStart = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return
    event.stopPropagation()
    const point = pointInCanvas(event)
    selectionOrigin.current = point
    setSelection({ x: point.x, y: point.y, width: 0, height: 0 })
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleSelectionMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const origin = selectionOrigin.current
    if (origin === null) return
    const point = pointInCanvas(event)
    setSelection({
      x: Math.min(origin.x, point.x),
      y: Math.min(origin.y, point.y),
      width: Math.abs(point.x - origin.x),
      height: Math.abs(point.y - origin.y),
    })
  }

  const handleSelectionEnd = (event: PointerEvent<HTMLCanvasElement>) => {
    const origin = selectionOrigin.current
    selectionOrigin.current = null
    if (origin === null) return
    const point = pointInCanvas(event)
    const next = {
      x: Math.min(origin.x, point.x),
      y: Math.min(origin.y, point.y),
      width: Math.abs(point.x - origin.x),
      height: Math.abs(point.y - origin.y),
    }
    if (next.width < MINIMUM_SELECTION_SIZE || next.height < MINIMUM_SELECTION_SIZE) {
      setSelection(null)
    } else {
      setSelection(next)
    }
  }

  const useSelection = () => {
    if (selection === null) return
    inputActions.setDraft(`${draft}${selectionContext(selection)}`)
    onClose()
  }

  const downloadDrawing = () => {
    if (canvas.current === null) return
    canvas.current.toBlob((blob) => {
      if (blob === null) return
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'drawing.png'
      anchor.click()
      URL.revokeObjectURL(url)
    }, 'image/png')
  }

  const windowStyle = {
    '--dsh-drawing-offset-x': `${position.x}px`,
    '--dsh-drawing-offset-y': `${position.y}px`,
  } as CSSProperties

  return (
    <section
      className="dsh-drawing-window"
      role="dialog"
      aria-label="图片预览"
      style={windowStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      <header className="dsh-drawing-header">
        <span className="dsh-drawing-size">
          {size === null ? '— × —' : `${size.width} × ${size.height}`}
        </span>
        <div className="dsh-drawing-actions">
          {selection !== null && (
            <>
              <span className="dsh-drawing-selection-size">
                {selection.width} × {selection.height}
              </span>
              <button
                className="dsh-drawing-selection-action"
                type="button"
                onClick={() => setSelection(null)}
              >
                取消圈选
              </button>
              <button
                className="dsh-drawing-selection-action dsh-drawing-selection-confirm"
                type="button"
                onClick={useSelection}
              >
                使用圈选
              </button>
            </>
          )}
          <button
            className="dsh-drawing-download"
            type="button"
            aria-label="下载图片"
            onClick={downloadDrawing}
          >
            下载
          </button>
          <button
            className="dsh-drawing-close"
            type="button"
            aria-label="关闭图片预览"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </header>
      <div className="dsh-drawing-stage">
        <div className="dsh-drawing-checkerboard">
          <div className="dsh-drawing-canvas-wrap">
            <canvas
              ref={canvas}
              aria-label="根据绘图工具调用重放的图片；拖动可圈选图片区域"
              onPointerDown={handleSelectionStart}
              onPointerMove={handleSelectionMove}
              onPointerUp={handleSelectionEnd}
              onPointerCancel={handleSelectionEnd}
            />
            {selection !== null && size !== null && (
              <div
                className="dsh-drawing-selection"
                aria-hidden
                style={{
                  left: `${(selection.x / size.width) * 100}%`,
                  top: `${(selection.y / size.height) * 100}%`,
                  width: `${(selection.width / size.width) * 100}%`,
                  height: `${(selection.height / size.height) * 100}%`,
                }}
              />
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
