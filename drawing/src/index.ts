import type { Context } from '@deepseek-ai/cordis'
import { defineTool, ToolArgsError } from '@deepseek-ai/dsh-tools'
import {
  validateCreateImageArguments,
  validateEditImageArguments,
  validateQueryImageArguments,
  validateVersionedImageArguments,
  type ValidationResult,
} from './shared/index.ts'

export const name = 'drawing'
export const inject = ['tools']

const output = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ok: { type: 'boolean', required: true },
    },
  },
  render: (_args: unknown, value: { ok: boolean }) => [
    { type: 'text' as const, text: JSON.stringify(value) },
  ],
} as const

function completeAfterValidation(result: ValidationResult): { ok: true } {
  if (result.isError) throw new ToolArgsError([result.msg])
  return { ok: true }
}

export function apply(ctx: Context): void {
  ctx.tools.register(
    defineTool({
      name: 'create_image',
      description:
        'Create a new drawing image. This server validates the request but does not render it.',
      parameters: {
        width: { type: 'integer', required: true, description: 'Image width in pixels.' },
        height: { type: 'integer', required: true, description: 'Image height in pixels.' },
        background: { type: 'string', description: 'transparent or a #RRGGBB/#RRGGBBAA color.' },
        replace: { type: 'boolean', description: 'Whether an existing image may be replaced.' },
      },
      output,
      async execute(args) {
        return completeAfterValidation(validateCreateImageArguments(args))
      },
      presentCall: (args) => ({
        card: 'generic',
        title: '创建图片',
        kind: 'other',
        rawInput: args,
      }),
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'query_image',
      description:
        'Query drawing image metadata. This server validates the request but does not read an image.',
      parameters: {
        scope: { type: 'string', required: true, enum: ['summary', 'selection', 'region'] },
        bounds: {
          type: 'object',
          additionalProperties: true,
          description: 'Required for region scope: { x, y, w, h }.',
        },
      },
      output,
      async execute(args) {
        return completeAfterValidation(validateQueryImageArguments(args))
      },
      presentCall: (args) => ({
        card: 'generic',
        title: '查询图片',
        kind: 'other',
        rawInput: args,
      }),
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'edit_image',
      description:
        'Apply drawing operations. This server validates the request but does not render it.',
      parameters: {
        expectedVersion: { type: 'integer', required: true },
        selection: { type: 'object', additionalProperties: true, required: true },
        ops: {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
          required: true,
        },
      },
      output,
      async execute(args) {
        return completeAfterValidation(validateEditImageArguments(args))
      },
      presentCall: (args) => ({
        card: 'generic',
        title: '编辑图片',
        kind: 'other',
        rawInput: args,
      }),
    }),
  )

  for (const [toolName, title] of [
    ['undo_image', '撤销图片编辑'],
    ['redo_image', '重做图片编辑'],
  ] as const) {
    ctx.tools.register(
      defineTool({
        name: toolName,
        description: `${title}。This server validates the request but does not modify an image.`,
        parameters: { expectedVersion: { type: 'integer', required: true } },
        output,
        async execute(args) {
          return completeAfterValidation(validateVersionedImageArguments(args))
        },
        presentCall: (args) => ({ card: 'generic', title, kind: 'other', rawInput: args }),
      }),
    )
  }
}
