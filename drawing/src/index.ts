import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { DrawingError, alphaStats, createDocument, edit, normalizeRect, redo, undo, type EditOperation, type ImageDocument, type Rect } from './raster.ts'

export const name = 'drawing'
export const inject = ['tools']

const documents = new WeakMap<object, ImageDocument>()
type Execution = { agent?: { session: object } }
const sessionOf = (exec: Execution): object => { if (exec.agent === undefined) throw new Error('drawing tools require an agent-owned session'); return exec.agent.session }
// The public result intentionally contains only metadata/statistics, never pixels or a PNG.
const output = {
  schema: { type: 'object', additionalProperties: false, properties: {
    imageId: { type: 'string', required: true }, version: { type: 'integer', required: true }, width: { type: 'integer', required: true }, height: { type: 'integer', required: true },
    selection: { required: true, oneOf: [{ type: 'object', additionalProperties: false, properties: { type: { type: 'string', required: true }, x: { type: 'number', required: true }, y: { type: 'number', required: true }, w: { type: 'number', required: true }, h: { type: 'number', required: true } } }, { type: 'null' }] },
    bounds: { type: 'object', required: true, additionalProperties: false, properties: { x: { type: 'number', required: true }, y: { type: 'number', required: true }, w: { type: 'number', required: true }, h: { type: 'number', required: true } } },
    alpha: { type: 'object', required: true, additionalProperties: false, properties: { opaque: { type: 'integer', required: true }, transparent: { type: 'integer', required: true }, partial: { type: 'integer', required: true } } },
  } }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }],
} as const
const imageOutput: any = {
  schema: { type: 'object', additionalProperties: true, properties: {} },
  render: () => [{ type: 'text', text: JSON.stringify({ ok: true }) }],
  presentationMeta: (_args: unknown, value: any) => ({
    image: { imageId: value.imageId, version: value.version, width: value.width, height: value.height, selection: value.selection },
  }),
}
const rectParameters = { x: { type: 'number', required: true }, y: { type: 'number', required: true }, w: { type: 'number', required: true }, h: { type: 'number', required: true } } as const
function documentOf(exec: Execution): ImageDocument { const doc = documents.get(sessionOf(exec)); if (doc === undefined) throw new DrawingError('no image exists; call create_image first'); return doc }
function requireVersion(doc: ImageDocument, expected: number): void { if (!Number.isInteger(expected) || expected !== doc.version) throw new DrawingError(`expectedVersion ${expected} does not match current version ${doc.version}`) }
function result(doc: ImageDocument, area: Rect = { x: 0, y: 0, w: doc.width, h: doc.height }) { const bounds = normalizeRect(area, doc); return { imageId: doc.id, version: doc.version, width: doc.width, height: doc.height, selection: doc.selection, bounds, alpha: alphaStats(doc, bounds) } }
function selectionContext(doc: ImageDocument): string { const selection = doc.selection!; return `[当前图像上下文]\nimageId=${doc.id}, version=${doc.version}, size=${doc.width}x${doc.height}\n用户已选择区域：rect(x=${selection.x}, y=${selection.y}, w=${selection.w}, h=${selection.h})。\n当用户说“这里”“选中区域”且未另行指定范围时，优先使用此区域；不得修改其外部像素。` }

export function apply(ctx: Context): void {
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const decision = await next()
    const doc = documents.get(agent.session)
    if (decision.kind !== 'enter' || doc?.selection === null || doc === undefined) return decision
    return { kind: 'enter', messages: [createUserMessage({ content: [{ type: 'text', text: selectionContext(doc) }], source: { kind: 'plugin', plugin: '@meing/dsh-drawing-plugin' } }), ...decision.messages] }
  })
  ctx.tools.register(defineTool({ name: 'create_image', description: '创建当前会话唯一的固定尺寸图像。已有图像只能在用户明确同意替换时传 replace=true。成功后仅返回成功状态；需要当前版本或尺寸时调用 query_image。', parameters: { width: { type: 'integer', required: true }, height: { type: 'integer', required: true }, background: { type: 'string', description: 'transparent 或 #RRGGBB/#RRGGBBAA' }, replace: { type: 'boolean' } } as any, output: imageOutput, async execute(args: any, exec: any) { const session = sessionOf(exec); if (documents.has(session) && args.replace !== true) throw new DrawingError('an image already exists; pass replace=true only with explicit user authorization'); const doc = createDocument(Number(args.width), Number(args.height), typeof args.background === 'string' ? args.background : 'transparent'); documents.set(session, doc); return result(doc) }, presentCall: (args: any) => ({ card: 'generic', title: '创建画面', kind: 'other', rawInput: args }) } as any))
  ctx.tools.register(defineTool({ name: 'query_image', description: '读取图像结构化状态，不返回原始像素。', parameters: { scope: { type: 'string', required: true, enum: ['summary', 'selection', 'region'] }, bounds: { type: 'object', additionalProperties: false, properties: rectParameters } } as any, output, async execute(args, exec) { const doc = documentOf(exec); if (args.scope === 'selection') return result(doc, doc.selection ?? { x: 0, y: 0, w: doc.width, h: doc.height }); if (args.scope === 'region') { if (args.bounds === undefined) throw new DrawingError('bounds is required when scope is region'); return result(doc, args.bounds as Rect) } return result(doc) }, presentCall: args => ({ card: 'generic', title: '查看画面状态', kind: 'other', rawInput: args }) }))
  ctx.tools.register(defineTool({ name: 'edit_image', description: '以单个原子事务执行基础栅格编辑。调用前必须使用 query_image 获取当前 version。除明确全图外，始终提供 rect 选区。成功后仅返回成功状态；客户端会自动回放并刷新画面。', parameters: { expectedVersion: { type: 'integer', required: true }, selection: { type: 'object', required: true, additionalProperties: true, properties: {} }, ops: { type: 'array', required: true, items: { type: 'object', additionalProperties: true, properties: {} } } } as any, output: imageOutput, async execute(args: any, exec: any) { const doc = documentOf(exec); requireVersion(doc, Number(args.expectedVersion)); const selection = args.selection as { type?: string } & Rect; const area = selection.type === 'all' ? { x: 0, y: 0, w: doc.width, h: doc.height } : selection.type === 'current' ? doc.selection : selection.type === 'rect' ? selection : null; if (area === null) throw new DrawingError('selection must be all, current, or rect; current requires an active user selection'); edit(doc, area, args.ops as EditOperation[]); return result(doc) }, presentCall: (args: any) => ({ card: 'generic', title: '编辑画面', kind: 'other', rawInput: args }) } as any))
  ctx.tools.register(defineTool({ name: 'undo_image', description: '撤销当前图像最近的一次原子编辑。', parameters: { expectedVersion: { type: 'integer', required: true } } as any, output, async execute(args, exec) { const doc = documentOf(exec); requireVersion(doc, Number(args.expectedVersion)); undo(doc); return result(doc) }, presentCall: args => ({ card: 'generic', title: '撤销画面编辑', kind: 'other', rawInput: args }) }))
  ctx.tools.register(defineTool({ name: 'redo_image', description: '重做当前图像最近撤销的一次原子编辑。', parameters: { expectedVersion: { type: 'integer', required: true } } as any, output, async execute(args, exec) { const doc = documentOf(exec); requireVersion(doc, Number(args.expectedVersion)); redo(doc); return result(doc) }, presentCall: args => ({ card: 'generic', title: '重做画面编辑', kind: 'other', rawInput: args }) }))
}
