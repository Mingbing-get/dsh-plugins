import { useEffect, useMemo } from 'react'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { DrawingWindow } from './window.tsx'
import type { DrawingInfo, DrawingStore } from './store.ts'
import { drawingHistoryFromNodes, replayDrawingHistory } from './replay.ts'

type Props = ToolCallViewProps & PropsStore<DrawingStore>
function isDrawingInfo(value: unknown): value is DrawingInfo { return typeof value === 'object' && value !== null && 'imageId' in value && typeof value.imageId === 'string' && 'version' in value && Number.isInteger(value.version) && 'width' in value && Number.isInteger(value.width) && 'height' in value && Number.isInteger(value.height) }
function valueOf(block: ToolCallBlock): DrawingInfo | null { if (!('kind' in block)) return null; if (typeof block.meta === 'object' && block.meta !== null && 'image' in block.meta && isDrawingInfo(block.meta.image)) return block.meta.image; try { const value = JSON.parse(block.content.filter(item => item.type === 'text').map(item => item.text).join('')) as unknown; return isDrawingInfo(value) ? value : null } catch { return null } }
function label(name: string): string { return ({ create_image: '创建画面', query_image: '读取画面', edit_image: '编辑画面', undo_image: '撤销编辑', redo_image: '重做编辑' } as Record<string, string>)[name] ?? '画面操作' }

export function createDrawingToolRow(ctx: any) {
  return function DrawingToolRow({ callId, toolName, block, sessionId, useSession, useStore, actions }: Props) {
    const value = useMemo(() => valueOf(block), [block])
    const image = useStore(s => s.image); const open = useStore(s => s.open); const owner = useStore(s => s.owner === callId)
    const nodes = useSession((snapshot: any) => snapshot.nodes)
    const hasMore = useSession((snapshot: any) => snapshot.hasMore)
    const loadingOlder = useSession((snapshot: any) => snapshot.loadingOlder)
    const commands = useMemo(() => drawingHistoryFromNodes(nodes), [nodes])
    useEffect(() => { if (value !== null) actions.sync(value, callId) }, [actions, callId, value])
    const isError = 'kind' in block && block.isError
    useEffect(() => { if (hasMore && !loadingOlder) void ctx.sessions.binding(sessionId)?.session.loadOlder() }, [hasMore, loadingOlder, sessionId])
    useEffect(() => { const url = replayDrawingHistory(commands); if (url !== null) actions.preview(url) }, [actions, commands])
    return <><div className="dsh-drawing-row"><span className="dsh-drawing-mark" /><span className="dsh-drawing-row-title">{label(toolName)}</span><span className="dsh-drawing-row-status">{'kind' in block ? (block.isError ? '操作失败' : value === null ? '等待画面' : `v${value.version} · ${value.width} × ${value.height}`) : '正在处理'}</span><button className="dsh-drawing-show" type="button" disabled={image === null} onClick={() => actions.reveal()}>{open ? '画面已显示' : '显示画面'}</button></div>{owner && open && image !== null && <DrawingWindow image={image} actions={actions} useStore={useStore} />}</>
  }
}
