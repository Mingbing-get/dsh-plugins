import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { createDrawingToolRow } from './tool-row.tsx'
import { createDrawingStore } from './store.ts'
import { installStyles } from './styles.ts'
export const inject = ['slots', 'sessions']
export function apply(ctx: ClientContext): void {
  const store = createDrawingStore()
  const DrawingToolRow = createDrawingToolRow(ctx)
  ctx.effect(installStyles, 'drawing: styles')
  ctx.slots.inject('tool.call.toolview', function* () {
    for (const key of ['create_image', 'query_image', 'edit_image', 'undo_image', 'redo_image'])
      yield ctx.slots.register({ name: 'tool.call.toolview', key, store }, DrawingToolRow)
  })
}
