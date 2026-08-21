import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { GomokuToolRow } from './GomokuToolRow.tsx'
import { createGomokuStore } from './store.ts'
import { installStyles } from './styles.ts'

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  const store = createGomokuStore()
  ctx.effect(installStyles, 'gomoku: styles')
  ctx.slots.inject('tool.call.toolview', function* () {
    yield ctx.slots.register(
      { name: 'tool.call.toolview', key: 'gomoku_start', store },
      GomokuToolRow,
    )
    yield ctx.slots.register(
      { name: 'tool.call.toolview', key: 'gomoku_move', store },
      GomokuToolRow,
    )
  })
}
