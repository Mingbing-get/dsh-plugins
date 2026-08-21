import { useEffect, useRef, useState } from 'react'
import type { ConversationSnapshot, ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { replayDrawing } from './replay.ts'
import type { DrawingCall, DrawingToolName } from './store.ts'

interface DrawingWindowProps {
  useSession: ToolCallViewProps['useSession']
  onClose: () => void
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

export function DrawingWindow({ useSession, onClose }: DrawingWindowProps) {
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
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  useEffect(() => {
    if (canvas.current === null) return
    setSize(replayDrawing(canvas.current, calls))
  }, [calls])

  return (
    <section className="dsh-drawing-window" role="dialog" aria-label="图片预览">
      <header className="dsh-drawing-header">
        <div>
          <p className="dsh-drawing-kicker">LIVE CANVAS</p>
          <h2>绘制预览</h2>
          <p>
            {size === null ? '等待可重放的图片数据' : `${size.width} × ${size.height} · 会话重放`}
          </p>
        </div>
        <button
          className="dsh-drawing-close"
          type="button"
          aria-label="关闭图片预览"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="dsh-drawing-stage">
        <div className="dsh-drawing-checkerboard">
          <canvas ref={canvas} aria-label="根据绘图工具调用重放的图片" />
        </div>
      </div>
      <footer>显示当前会话中所有绘图工具参数逐步重放后的画面。</footer>
    </section>
  )
}
