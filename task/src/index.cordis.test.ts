/**
 * Boot-level wiring test against a real cordis context.
 *
 * This reproduces the production failure mode: a plugin fiber may only read
 * services it injects, and `connection.rpc.handle` registers its route on the
 * *reading* fiber's `webServer`. The panel and the command surface are mounted
 * as capability-scoped child plugins, so the fakes below mirror the real
 * services closely enough to fail the same way if an inject declaration is ever
 * dropped.
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import * as plugin from './index.ts'

/** One registered web route, recorded by the fake web server. */
interface Route {
  path: string
}

/** Fake web server: records routes registered through the reading fiber. */
class FakeWebServer extends Service {
  readonly routes: Route[] = []

  constructor(ctx: Context) {
    super(ctx, 'webServer')
  }

  register(route: Route): () => void {
    this.routes.push(route)
    return () => {
      const index = this.routes.indexOf(route)
      if (index >= 0) this.routes.splice(index, 1)
    }
  }

  registerUpgrade(): () => void {
    return () => undefined
  }
}

/** Exact Fetch route recorded by the fake connection. */
interface FetchRoute {
  path: string
  methods: string[]
}

/**
 * Fake connection service.
 *
 * `legacy` reproduces DSH 0.1.5-rc.1: `rpc.handle` registers the physical route
 * through the *connection* plugin's own context (so it fails unless that
 * context injected `webServer`), and exact Fetch routes are the working
 * extension point. `modern` mirrors current DSH, where `rpc.handle` binds the
 * caller's context and succeeds.
 */
class FakeConnection extends Service {
  readonly fetchRoutes: FetchRoute[] = []

  constructor(
    ctx: Context,
    private readonly legacy: boolean,
  ) {
    super(ctx, 'connection')
  }

  get rpc(): { handle(channel: string): () => Promise<void> } {
    const owner = this.ctx as unknown as { webServer: FakeWebServer; effect: Context['effect'] }
    return {
      handle: (channel: string) => {
        // Legacy builds register on the provider's own fiber, which declares no
        // `webServer`; modern builds receive the caller's fiber instead.
        const target = this.legacy ? (this.ctx as unknown as typeof owner) : owner
        return target.effect(() => target.webServer.register({ path: channel }), `rpc ${channel}`)
      },
    }
  }

  get fetch(): { register(route: FetchRoute): () => void } {
    return {
      register: (route: FetchRoute) => {
        this.fetchRoutes.push(route)
        return () => {
          const index = this.fetchRoutes.indexOf(route)
          if (index >= 0) this.fetchRoutes.splice(index, 1)
        }
      },
    }
  }
}

interface Harness {
  ctx: Context
  tools: string[]
  commands: string[]
  webServer: FakeWebServer
  fetchRoutes: FetchRoute[]
  dispose(): Promise<void>
}

const ROUTE_ROOT = join(mkdtempSync(join(tmpdir(), 'task-wiring-')), 'workspace')

async function boot(
  options: { withWebServer?: boolean; withCommands?: boolean; legacy?: boolean } = {},
): Promise<Harness> {
  const ctx = new Context()
  const fibers: Fiber[] = []
  const tools: string[] = []
  const commands: string[] = []
  ctx.reflect.provide('tools', {
    register: (definition: { name: string }) => {
      tools.push(definition.name)
      return () => undefined
    },
  } as unknown as Context['tools'])
  ctx.reflect.provide('agents', {
    create: () => Promise.reject(new Error('not used')),
  } as unknown as Context['agents'])
  ctx.reflect.provide('userQuestions', {
    ask: () => Promise.reject(new Error('not used')),
  } as unknown as Context['userQuestions'])
  ctx.reflect.provide('systemPrompt', {
    context: () => undefined,
  } as unknown as Context['systemPrompt'])
  if (options.withCommands !== false) {
    ctx.reflect.provide('commands', {
      register: (definition: { name: string }) => {
        commands.push(definition.name)
        return () => undefined
      },
    } as unknown as Context['commands'])
  }
  let webServer: FakeWebServer | undefined
  let connection: FakeConnection | undefined
  if (options.withWebServer !== false) {
    fibers.push(
      await ctx.plugin({
        name: 'fake-webserver',
        apply: (webCtx: Context) => {
          webServer = new FakeWebServer(webCtx)
        },
      }),
    )
  }
  fibers.push(
    await ctx.plugin({
      name: 'fake-connection',
      apply: (connectionCtx: Context) => {
        connection = new FakeConnection(connectionCtx, options.legacy === true)
      },
    }),
  )
  fibers.push(
    await ctx.plugin(
      {
        name: plugin.name,
        inject: [...plugin.inject],
        Config: plugin.Config,
        apply: plugin.apply,
      },
      { workspaceRoot: ROUTE_ROOT },
    ),
  )
  return {
    ctx,
    tools,
    commands,
    webServer: webServer as FakeWebServer,
    fetchRoutes: connection?.fetchRoutes ?? [],
    dispose: async () => {
      for (const fiber of fibers.reverse()) await fiber.dispose()
    },
  }
}

const harnesses: Harness[] = []

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.dispose()
})

describe('plugin boot wiring', () => {
  it('loads the tools, the panel, and the command surface', async () => {
    const harness = await boot()
    harnesses.push(harness)

    expect(harness.tools).toEqual([
      'task_requirement_draft',
      'task_requirement_confirm',
      'task_system_features_read',
      'task_system_features_apply',
      'task_plan_create',
      'task_query',
      'task_progress',
      'task_retry',
      'task_skip',
    ])
    expect(harness.commands).toContain('task')
    // The fake mirrors the shipped build, where the channel cannot mount from a
    // plugin fiber: the panel comes up on the `/api` Fetch routes instead.
    expect(harness.fetchRoutes).toHaveLength(5)
  })

  it('falls back to exact /api Fetch routes on DSH 0.1.5-rc.1', async () => {
    // On that build `rpc.handle` registers through the connection plugin's own
    // fiber, which cannot read `webServer`, so the panel must use the Fetch
    // routes instead of failing to load.
    const harness = await boot({ legacy: true })
    harnesses.push(harness)
    expect(harness.tools).toHaveLength(9)
    expect(harness.fetchRoutes.map((route) => route.path)).toEqual([
      '/api/task-orchestrator/snapshot',
      '/api/task-orchestrator/read',
      '/api/task-orchestrator/dismiss',
      '/api/task-orchestrator/retry',
      '/api/task-orchestrator/skip',
    ])
    for (const route of harness.fetchRoutes) expect(route.methods).toEqual(['POST'])
  })

  it('still loads the tools when the deployment has no web server', async () => {
    const harness = await boot({ withWebServer: false })
    harnesses.push(harness)
    expect(harness.tools).toHaveLength(9)
    // The panel never starts instead of failing the whole plugin.
    expect(harness.commands).toContain('task')
  })

  it('still loads the tools when the deployment has no command adapter', async () => {
    const harness = await boot({ withCommands: false })
    harnesses.push(harness)
    expect(harness.tools).toHaveLength(9)
    expect(harness.commands).toEqual([])
    expect(harness.fetchRoutes).toHaveLength(5)
  })

  it('creates no workspace files while merely loading', async () => {
    const harness = await boot()
    harnesses.push(harness)
    const { existsSync } = await import('node:fs')
    expect(existsSync(ROUTE_ROOT)).toBe(false)
  })

  it('proves the fakes reproduce the missing-inject failure', async () => {
    // A fiber that reads `connection.rpc` without injecting `webServer` fails
    // exactly like the production boot error did.
    const ctx = new Context()
    const webserverFiber = await ctx.plugin({
      name: 'fake-webserver',
      apply: (webCtx: Context) => {
        new FakeWebServer(webCtx)
      },
    })
    const connectionFiber = await ctx.plugin({
      name: 'fake-connection',
      apply: (connectionCtx: Context) => {
        new FakeConnection(connectionCtx, true)
      },
    })
    await expect(
      ctx.plugin({
        name: 'guilty',
        inject: ['connection'],
        apply: (guiltyCtx: Context) => {
          guiltyCtx.connection.rpc.handle('/guilty', async () => ({ ok: true, value: {} }), {
            authority: 'trusted-host',
          })
        },
      }),
    ).rejects.toThrowError(/webServer/)
    await connectionFiber.dispose()
    await webserverFiber.dispose()
  })
})
