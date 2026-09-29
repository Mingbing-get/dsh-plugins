/**
 * Task orchestrator client plugin.
 *
 * Registers the floating intervention panel into the shell overlay: a
 * click-through frame-wide layer, so the panel never blocks the app.
 *
 * 交互与展示要求见 `task/docs/products/task-orchestrator.md` 第 5.8 节。
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { TaskPanel } from './TaskPanel.tsx'
import { setPanelConnection } from './panel-api.ts'
import { installStyles } from './styles.ts'

export const name = 'task-orchestrator-client'

/** Services required by the panel. */
export const inject = ['slots', 'connection'] as const

/**
 * Install the intervention panel.
 * @param ctx - client plugin context.
 */
export function apply(ctx: ClientContext): void {
  setPanelConnection(
    ctx.connection as unknown as import('@deepseek-ai/dsh-client-connection/client').ConnectionHandle,
  )
  ctx.effect(installStyles, 'task-orchestrator: panel styles')
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      { name: 'shell.overlay', id: 'task-orchestrator-panel', order: 60, label: '任务编排' },
      TaskPanel,
    ),
  )
}
