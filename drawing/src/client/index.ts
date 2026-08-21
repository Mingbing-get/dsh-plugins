import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { DrawingToolRow } from './DrawingToolRow.tsx'
import { createDrawingStore } from './store.ts'
import { installStyles } from './styles.ts'

const TOOL_NAMES = [
  'create_image',
  'query_image',
  'edit_image',
  'undo_image',
  'redo_image',
] as const

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  const store = createDrawingStore()
  ctx.effect(installStyles, 'drawing: styles')
  ctx.slots.inject('tool.call.toolview', function* () {
    for (const key of TOOL_NAMES) {
      yield ctx.slots.register({ name: 'tool.call.toolview', key, store }, DrawingToolRow)
    }
  })
}
