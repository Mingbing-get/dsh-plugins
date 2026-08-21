import { defineTool } from '@deepseek-ai/dsh-tools'
import { validateCreateImageArguments } from '../shared/index.ts'
import { completeAfterValidation, output } from './shared.ts'

export const createImageTool = defineTool({
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
  presentCall: (args) => ({ card: 'generic', title: '创建图片', kind: 'other', rawInput: args }),
})
