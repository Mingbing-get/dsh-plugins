/**
 * Panel transport selection and endpoint behaviour.
 *
 * DSH builds differ in how a plugin may expose HTTP endpoints, so the
 * installer must mount on whichever mechanism works and never take the whole
 * plugin down with it.
 */

import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { createPanelHandler, installPanelBridge } from './panel.ts'
import { PANEL_ENDPOINTS, PANEL_FETCH_PREFIX, panelFetchPath } from '../shared/panel-protocol.ts'
import { WorkspaceRegistry } from '../workspace/registry.ts'
import type { OrchestratorLogger } from '../service.ts'
import { resolveOptions } from '../domain/config.ts'
import type { AgentRunner } from '../agents/session.ts'

const logger: OrchestratorLogger = { info: () => {}, warn: () => {}, error: () => {} }
const agents: AgentRunner = { run: () => Promise.reject(new Error('unused')) }

function emptyRegistry(): WorkspaceRegistry {
  return new WorkspaceRegistry({
    options: resolveOptions({}, process.cwd()),
    logger,
    agents,
    enableScheduler: false,
  })
}

interface ChannelCall {
  channel: string
  options: unknown
}

/** Context whose RPC channel registration succeeds (current DSH). */
function modernContext(calls: ChannelCall[]): Context {
  return {
    connection: {
      rpc: {
        handle: (channel: string, _handler: unknown, options: unknown) => {
          calls.push({ channel, options })
          return Promise.resolve()
        },
      },
    },
  } as unknown as Context
}

/** Context whose RPC channel throws and that offers exact Fetch routes (0.1.5-rc.1). */
function legacyContext(routes: { path: string; methods: string[] }[]): Context {
  return {
    connection: {
      rpc: {
        handle: () => {
          throw new Error('cannot get property "webServer" without inject')
        },
      },
      fetch: {
        register: (route: { path: string; methods: string[] }) => {
          routes.push(route)
          return () => undefined
        },
      },
    },
  } as unknown as Context
}

describe('panel transport', () => {
  it('prefers the plugin-owned RPC channel when it mounts', () => {
    const calls: ChannelCall[] = []
    const transport = installPanelBridge(modernContext(calls), emptyRegistry(), logger)
    expect(transport).toBe('channel')
    expect(calls.map((call) => call.channel)).toEqual(['/task-orchestrator'])
    expect(calls[0]?.options).toEqual({ authority: 'trusted-host' })
  })

  it('falls back to exact /api Fetch routes when the channel cannot mount', () => {
    const routes: { path: string; methods: string[] }[] = []
    const transport = installPanelBridge(legacyContext(routes), emptyRegistry(), logger)
    expect(transport).toBe('fetch')
    expect(routes.map((route) => route.path)).toEqual(PANEL_ENDPOINTS.map(panelFetchPath))
    for (const route of routes) {
      expect(route.path.startsWith(`${PANEL_FETCH_PREFIX}/`)).toBe(true)
      expect(route.methods).toEqual(['POST'])
    }
  })

  it('fails loudly when neither transport exists', () => {
    const bare = { connection: { rpc: { handle: () => Promise.resolve() } } } as unknown as Context
    // A channel that mounts is enough; with no channel and no fetch registry,
    // the installer must report rather than silently drop the panel.
    let threw = false
    try {
      installPanelBridge(
        {
          connection: {
            rpc: {
              handle: () => {
                throw new Error('unavailable')
              },
            },
          },
        } as unknown as Context,
        emptyRegistry(),
        logger,
      )
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
    expect(installPanelBridge(bare, emptyRegistry(), logger)).toBe('channel')
  })
})

describe('panel handler', () => {
  it('answers an empty snapshot before any workspace is opened', async () => {
    const handler = createPanelHandler(emptyRegistry())
    const outcome = await handler({ endpoint: 'snapshot', payload: {} })
    expect(outcome.ok).toBe(true)
    const snapshot = outcome.ok ? (outcome.value as Record<string, unknown>) : {}
    expect(snapshot['unread']).toBe(0)
    expect(snapshot['notifications']).toEqual([])
    expect(snapshot['workspaces']).toEqual([])
    expect(snapshot['counts']).toMatchObject({ pending: 0, failed: 0 })
  })

  it('rejects malformed actions with an actionable message', async () => {
    const handler = createPanelHandler(emptyRegistry())
    const missingTask = await handler({ endpoint: 'retry', payload: {} })
    expect(missingTask.ok).toBe(false)
    if (!missingTask.ok) expect(missingTask.error).toContain('retry 需要 taskId')

    const unknownTask = await handler({ endpoint: 'skip', payload: { taskId: 'T99' } })
    expect(unknownTask.ok).toBe(false)
    if (!unknownTask.ok) expect(unknownTask.error).toContain('T99')

    const missingNotification = await handler({ endpoint: 'dismiss', payload: {} })
    expect(missingNotification.ok).toBe(false)
    if (!missingNotification.ok) expect(missingNotification.error).toContain('notificationId')
  })
})
