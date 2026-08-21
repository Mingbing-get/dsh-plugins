import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions'
import type { Drawing } from '../shared/index.ts'
import { validateQueryImageArguments } from '../shared/index.ts'
import { completeAfterValidation } from './shared.ts'

const output = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      imageId: { type: 'string', required: true },
      version: { type: 'integer', required: true },
      width: { type: 'integer', required: true },
      height: { type: 'integer', required: true },
      selection: {
        required: true,
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              type: { type: 'string', required: true, enum: ['rect'] },
              x: { type: 'number', required: true },
              y: { type: 'number', required: true },
              w: { type: 'number', required: true },
              h: { type: 'number', required: true },
            },
          },
          { type: 'null' },
        ],
      },
      bounds: {
        type: 'object',
        required: true,
        additionalProperties: false,
        properties: {
          x: { type: 'number', required: true },
          y: { type: 'number', required: true },
          w: { type: 'number', required: true },
          h: { type: 'number', required: true },
        },
      },
      alpha: {
        type: 'object',
        required: true,
        additionalProperties: false,
        properties: {
          opaque: { type: 'integer', required: true },
          transparent: { type: 'integer', required: true },
          partial: { type: 'integer', required: true },
        },
      },
      clipped: { type: 'boolean', required: true },
    },
  },
  render: (_args: unknown, value: unknown) => [
    { type: 'text' as const, text: JSON.stringify(value) },
  ],
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0
}

function isRect(value: unknown): value is Drawing.Rect {
  return (
    isRecord(value) &&
    [value.x, value.y, value.w, value.h].every(
      (part) => typeof part === 'number' && Number.isFinite(part),
    )
  )
}

function isQueryResult(value: unknown): value is Drawing.ImageResult {
  if (!isRecord(value) || typeof value.imageId !== 'string') return false
  if (!isNonNegativeInteger(value.version)) return false
  if (!isPositiveInteger(value.width) || !isPositiveInteger(value.height)) return false
  if (
    value.selection !== null &&
    !(isRecord(value.selection) && value.selection.type === 'rect' && isRect(value.selection))
  )
    return false
  if (!isRect(value.bounds) || typeof value.clipped !== 'boolean' || !isRecord(value.alpha))
    return false
  return [value.alpha.opaque, value.alpha.transparent, value.alpha.partial].every(
    isNonNegativeInteger,
  )
}

function queryResult(answer: AskUserQuestionAnswer): Drawing.ImageResult {
  const raw = answer.answers.find((item) => item.id === 'drawing-query-image')?.custom
  if (raw === undefined) throw new Error('the drawing client returned no image result')
  let response: unknown
  try {
    response = JSON.parse(raw)
  } catch {
    throw new Error('the drawing client returned malformed image metadata')
  }
  if (!isRecord(response)) throw new Error('the drawing client returned invalid image metadata')
  if (response.ok === false && typeof response.error === 'string') throw new Error(response.error)
  if (response.ok !== true || !isQueryResult(response.value))
    throw new Error('the drawing client returned invalid image metadata')
  return response.value
}

export function createQueryImageTool(ctx: Context) {
  return defineTool({
    name: 'query_image',
    description:
      'Query drawing image metadata from the current client-side drawing document. It never returns raw pixels.',
    parameters: {
      scope: { type: 'string', required: true, enum: ['summary', 'selection', 'region'] },
      bounds: {
        type: 'object',
        additionalProperties: true,
        description: 'Required for region scope: { x, y, w, h }.',
      },
    },
    output,
    async execute(args, exec) {
      completeAfterValidation(validateQueryImageArguments(args))
      const answer = await ctx.userQuestions.ask({
        questions: [
          {
            id: 'drawing-query-image',
            header: 'drawing:query-image',
            question: '读取当前绘图文档的结构化信息。',
            detail: JSON.stringify(args),
          },
        ],
        ...(exec.agent === undefined ? {} : { agent: exec.agent }),
        signal: exec.signal,
      })
      return queryResult(answer)
    },
    presentCall: (args) => ({ card: 'generic', title: '查询图片', kind: 'other', rawInput: args }),
  })
}
