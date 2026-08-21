import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { validateImageResult, validateQueryImageArguments } from '../shared/index.ts'
import type { ImageMetadataBridge } from './image-metadata-bridge.ts'
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

export function createQueryImageTool(_ctx: Context, bridge: ImageMetadataBridge) {
  return defineTool({
    name: 'query_image',
    description: 'Query current client-side drawing metadata; it never returns raw pixels.',
    parameters: {
      scope: { type: 'string', required: true, enum: ['summary', 'selection', 'region'] },
      bounds: {
        type: 'object',
        additionalProperties: true,
        description: 'Required for region scope.',
      },
    },
    output,
    async execute(args, exec) {
      completeAfterValidation(validateQueryImageArguments(args))
      if (exec.agent === undefined)
        throw new Error('query_image requires an active drawing session')
      const result = await bridge.wait(exec.agent.id, exec.callId, exec.signal)
      const validation = validateImageResult(result)
      if (validation.isError) throw new Error(validation.msg)
      return result
    },
    presentCall: (args) => ({ card: 'generic', title: '查询图片', kind: 'other', rawInput: args }),
  })
}
