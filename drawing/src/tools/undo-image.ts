import { defineTool } from '@deepseek-ai/dsh-tools'
import { validateVersionedImageArguments } from '../shared/index.ts'
import { completeAfterValidation, output } from './shared.ts'

export const undoImageTool = defineTool({
  name: 'undo_image',
  description: '撤销图片编辑。This server validates the request but does not modify an image.',
  parameters: { expectedVersion: { type: 'integer', required: true } },
  output,
  async execute(args) {
    return completeAfterValidation(validateVersionedImageArguments(args))
  },
  presentCall: (args) => ({
    card: 'generic',
    title: '撤销图片编辑',
    kind: 'other',
    rawInput: args,
  }),
})
