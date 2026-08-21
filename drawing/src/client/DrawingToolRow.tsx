import { useEffect, useRef } from 'react'
import type { PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { drawingCalls, DrawingWindow } from './DrawingWindow.tsx'
import { queryDrawing } from './replay.ts'
import type { DrawingStore, DrawingToolName } from './store.ts'

type DrawingToolRowProps = ToolCallViewProps & PropsStore<DrawingStore>

let connection: ConnectionHandle | undefined

export function setDrawingConnection(next: ConnectionHandle): void {
  connection = next
}

function title(toolName: DrawingToolName): string {
  return {
    create_image: '创建图片',
    query_image: '查询图片',
    edit_image: '编辑图片',
    undo_image: '撤销图片编辑',
    redo_image: '重做图片编辑',
  }[toolName]
}

export function DrawingToolRow({
  callId,
  toolName,
  block,
  useSession,
  sessionId,
  useStore,
  actions,
}: DrawingToolRowProps) {
  const publishedQueries = useRef(new Set<string>())
  const hasImage = useStore((state) => state.hasImage)
  const open = useStore((state) => state.open)
  const owner = useStore((state) => state.ownerCallId === callId)
  const calls = useSession(drawingCalls)

  useEffect(() => {
    actions.syncCall({ id: callId, name: toolName as DrawingToolName })
  }, [actions, callId, toolName])

  useEffect(() => {
    if (toolName !== 'query_image' || 'kind' in block || publishedQueries.current.has(callId))
      return
    if (connection === undefined) return
    let query: Parameters<typeof queryDrawing>[2]
    try {
      query = JSON.parse(block.argsRaw) as Parameters<typeof queryDrawing>[2]
    } catch {
      return
    }
    const canvas = document.createElement('canvas')
    const result = queryDrawing(canvas, calls, query)
    publishedQueries.current.add(callId)
    void connection.rpc.call('/drawing', 'image-metadata', { sessionId, callId, result })
  }, [block, callId, calls, sessionId, toolName])

  return (
    <>
      <div className="dsh-drawing-tool-row">
        <span className="dsh-drawing-tool-mark" aria-hidden />
        <span className="dsh-drawing-tool-title">{title(toolName as DrawingToolName)}</span>
        <span className="dsh-drawing-tool-status">
          {'kind' in block ? (block.isError ? '调用失败' : '已完成') : '正在执行'}
        </span>
        <button
          className="dsh-drawing-show"
          type="button"
          disabled={!hasImage}
          onClick={() => actions.reveal()}
        >
          {open ? '画面已显示' : '显示图片'}
        </button>
      </div>
      {owner && open && hasImage && (
        <DrawingWindow useSession={useSession} onClose={() => actions.close()} />
      )}
    </>
  )
}
