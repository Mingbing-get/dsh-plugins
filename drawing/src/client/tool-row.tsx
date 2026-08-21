import { useEffect, useMemo } from 'react'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { DrawingWindow } from './window.tsx'
import type { DrawingInfo, DrawingStore } from './store.ts'

type Props = ToolCallViewProps & PropsStore<DrawingStore>
interface Attachment { attachmentId: string; mediaType: string; bytes: number; width: number; height: number }
function valueOf(block: ToolCallBlock): DrawingInfo | null { if (!('kind' in block)) return null; try { const value = JSON.parse(block.content.filter(item => item.type === 'text').map(item => item.text).join('')) as DrawingInfo; return typeof value.imageId === 'string' && Number.isInteger(value.version) ? value : null } catch { return null } }
function attachmentOf(block: ToolCallBlock): Attachment | null { if (!('kind' in block)) return null; const image = block.content.find(item => item.type === 'image'); return image?.type === 'image' ? image.attachment as Attachment : null }
function label(name: string): string { return ({ create_image: '创建画面', query_image: '读取画面', edit_image: '编辑画面', render_image: '渲染画面', save_image: '导出 PNG', undo_image: '撤销编辑', redo_image: '重做编辑' } as Record<string, string>)[name] ?? '画面操作' }

export function createDrawingToolRow(loadImage: (sessionId: string, attachment: Attachment) => Promise<string>) {
  return function DrawingToolRow({ callId, toolName, block, sessionId, useStore, actions }: Props) {
    const value = useMemo(() => valueOf(block), [block]); const attachment = useMemo(() => attachmentOf(block), [block])
    const image = useStore(s => s.image); const open = useStore(s => s.open); const owner = useStore(s => s.owner === callId)
    useEffect(() => { if (value !== null) actions.sync(value, callId) }, [actions, callId, value])
    useEffect(() => { if (attachment === null) return; void loadImage(String(sessionId), attachment).then(url => actions.preview(url)).catch(() => undefined) }, [actions, attachment, loadImage, sessionId])
    return <><div className="dsh-drawing-row"><span className="dsh-drawing-mark" /><span className="dsh-drawing-row-title">{label(toolName)}</span><span className="dsh-drawing-row-status">{'kind' in block ? (block.isError ? '操作失败' : value === null ? '等待画面' : `v${value.version} · ${value.width} × ${value.height}`) : '正在处理'}</span><button className="dsh-drawing-show" type="button" disabled={image === null} onClick={() => actions.reveal()}>{open ? '画面已显示' : '显示画面'}</button></div>{owner && open && image !== null && <DrawingWindow image={image} actions={actions} useStore={useStore} />}</>
  }
}
