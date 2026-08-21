import { defineTool } from '@deepseek-ai/dsh-tools'
import { validateEditImageArguments } from '../shared/index.ts'
import { completeAfterValidation, output } from './shared.ts'

export const editImageTool = defineTool({
  name: 'edit_image',
  description:
    'Apply drawing operations. This server validates the request but does not render it.',
  parameters: {
    expectedVersion: { type: 'integer', required: true },
    selection: { type: 'object', additionalProperties: true, required: true },
    ops: { type: 'array', items: { type: 'object', additionalProperties: true }, required: true },
  },
  output,
  async execute(args) {
    return completeAfterValidation(validateEditImageArguments(args))
  },
  presentCall: (args) => ({ card: 'generic', title: '编辑图片', kind: 'other', rawInput: args }),
})
