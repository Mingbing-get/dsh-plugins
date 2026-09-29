/**
 * Execution-session tests.
 *
 * A task run must be watchable from the frontend: the session is created as an
 * ordinary conversation (no `origin: 'subagent'`), titled, and attached to the
 * workspace owning its repository. Internal runs stay hidden, and no surfacing
 * failure may ever fail the run itself.
 *
 * A run must also be *composable*: every session joins an agent preset, because
 * the preset is what carries the coding tools. A session that joins none reads
 * only the host plane, which in the Web profile is this plugin's own `task_*`
 * tools — a run that can neither read its task document nor touch the repo.
 */

import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { createDshAgentRunner } from './session.ts'
import type { AgentRunRequest } from './session.ts'

interface CreateCall {
  sessionId: string
  meta: Record<string, unknown>
  signal: AbortSignal | undefined
  agentOptions?: unknown
  hasSetup: boolean
}

interface Harness {
  runner: ReturnType<typeof createDshAgentRunner>
  created: CreateCall[]
  renamed: { sessionId: string; title: string }[]
  attach: { path: string; sessionId: string }[]
  presetRequests: (string | undefined)[]
  mounts: { presetId: string | undefined; agentCtx: unknown }[]
  warnings: string[]
  disposed: number
}

interface FakeOptions {
  /** Owner of the repository directory, when the registry already has one. */
  existingWorkspace?: boolean
  /** Throw from `create` (missing workspace registration). */
  createFails?: boolean
  /** Throw from `attachSession`. */
  attachFails?: boolean
  /** Throw from the title rename. */
  renameFails?: boolean
  /** Deployment without a workspace registry at all. */
  noRegistry?: boolean
  /** Deployment without a title service. */
  noTitle?: boolean
  /** Deployment with no preset roster (every session shares the host plane). */
  noPresets?: boolean
  /** Throw from the roster's `resolve` (unknown preset id). */
  resolveFails?: boolean
  /** Throw from the roster's `mount` (broken composition). */
  mountFails?: boolean
}

function harness(options: FakeOptions = {}): Harness {
  const created: CreateCall[] = []
  const renamed: { sessionId: string; title: string }[] = []
  const attach: { path: string; sessionId: string }[] = []
  const presetRequests: (string | undefined)[] = []
  const mounts: { presetId: string | undefined; agentCtx: unknown }[] = []
  const warnings: string[] = []
  const state = { disposed: 0 }

  const workspace = {
    attachSession: async (sessionId: SessionId): Promise<void> => {
      if (options.attachFails === true) throw new Error('attach exploded')
      attach.push({ path: 'resolved', sessionId })
    },
  }
  const registry =
    options.noRegistry === true
      ? undefined
      : {
          resolveByPath: async (path: string): Promise<typeof workspace | undefined> => {
            void path
            return options.existingWorkspace === true ? workspace : undefined
          },
          create: async (path: string): Promise<typeof workspace> => {
            if (options.createFails === true) throw new Error('create exploded')
            void path
            return workspace
          },
        }

  const presets =
    options.noPresets === true
      ? undefined
      : {
          resolve: async (id?: string): Promise<{ id: string }> => {
            presetRequests.push(id)
            if (options.resolveFails === true) throw new Error('unknown preset')
            return { id: id ?? 'standard' }
          },
          mount: async (agentCtx: unknown, id?: string): Promise<unknown> => {
            if (options.mountFails === true) throw new Error('preset exploded')
            mounts.push({ presetId: id, agentCtx })
            return undefined
          },
        }

  const ctx = {
    logger: {
      info: () => {},
      warn: (message: string) => warnings.push(message),
      error: () => {},
    },
    get: (name: string): unknown => {
      if (name === 'sessionTitle') {
        return options.noTitle === true
          ? undefined
          : {
              rename: (session: { id: string }, title: string): unknown => {
                if (options.renameFails === true) throw new Error('rename exploded')
                renamed.push({ sessionId: session.id, title })
                return undefined
              },
            }
      }
      if (name === 'workspaceRegistry') return registry
      if (name === 'agentPresets') return presets
      return undefined
    },
    agents: {
      create: async (call: {
        sessionId: SessionId
        meta: Record<string, unknown>
        signal?: AbortSignal
        setup?: (agentCtx: unknown) => Promise<void>
      }) => {
        created.push({
          sessionId: call.sessionId,
          meta: call.meta,
          signal: call.signal,
          agentOptions: (call as { agentOptions?: unknown }).agentOptions,
          hasSetup: call.setup !== undefined,
        })
        // The factory awaits setup before publishing; a rejection here rolls
        // the whole creation back, exactly like `agents.create`.
        const agent = {
          session: { id: call.sessionId },
          followup: () => {},
          whenIdle: async (): Promise<void> => {},
          cancel: () => {},
        }
        if (call.setup !== undefined) await call.setup({ agent, session: agent.session })
        return {
          agent,
          dispose: async (): Promise<void> => {
            state.disposed += 1
          },
        }
      },
    },
  } as unknown as Context

  return {
    runner: createDshAgentRunner(ctx),
    created,
    renamed,
    attach,
    presetRequests,
    mounts,
    warnings,
    get disposed() {
      return state.disposed
    },
  }
}

function request(extra: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return {
    label: 't1',
    instructions: '执行任务 T1',
    cwd: '/repo',
    sessionId: 'task-t1-abc',
    timeoutMs: 60_000,
    signal: new AbortController().signal,
    ...extra,
  }
}

describe('execution session surfacing', () => {
  it('hides an internal run as a subagent session', async () => {
    const h = harness()
    await h.runner.run(request())
    expect(h.created[0]?.meta).toEqual({
      cwd: '/repo',
      agentPreset: 'standard',
      origin: 'subagent',
    })
    expect(h.renamed).toEqual([])
    expect(h.attach).toEqual([])
  })

  it('creates a surfaced run as an ordinary session and titles it', async () => {
    const h = harness({ existingWorkspace: true })
    await h.runner.run(request({ surface: true, title: '任务 T1 · 邀请链接结构' }))
    expect(h.created[0]?.meta).toEqual({ cwd: '/repo', agentPreset: 'standard' })
    expect(h.created[0]?.meta).not.toHaveProperty('origin')
    expect(h.renamed).toEqual([{ sessionId: 'task-t1-abc', title: '任务 T1 · 邀请链接结构' }])
    expect(h.attach).toEqual([{ path: 'resolved', sessionId: 'task-t1-abc' }])
    expect(h.disposed).toBe(1)
  })

  it('registers a workspace for a directory nobody owned yet', async () => {
    const h = harness({ existingWorkspace: false })
    await h.runner.run(request({ surface: true, title: '任务 T1 · X' }))
    expect(h.attach).toEqual([{ path: 'resolved', sessionId: 'task-t1-abc' }])
  })

  it('keeps the run alive when surfacing fails', async () => {
    const attachFailing = harness({ existingWorkspace: true, attachFails: true })
    await expect(
      attachFailing.runner.run(request({ surface: true, title: '任务 T1 · X' })),
    ).resolves.toEqual({ sessionId: 'task-t1-abc', timedOut: false })
    expect(attachFailing.warnings.some((message) => message.includes('未挂到工作区'))).toBe(true)
    expect(attachFailing.disposed).toBe(1)

    const createFailing = harness({ createFails: true })
    await expect(
      createFailing.runner.run(request({ surface: true, title: '任务 T1 · X' })),
    ).resolves.toEqual({ sessionId: 'task-t1-abc', timedOut: false })
    expect(createFailing.warnings.some((message) => message.includes('未挂到工作区'))).toBe(true)

    const renameFailing = harness({ renameFails: true })
    await expect(
      renameFailing.runner.run(request({ surface: true, title: '任务 T1 · X' })),
    ).resolves.toEqual({ sessionId: 'task-t1-abc', timedOut: false })
    expect(renameFailing.warnings.some((message) => message.includes('标题写入失败'))).toBe(true)
  })

  it('tolerates a deployment without workspace or title services', async () => {
    const h = harness({ noRegistry: true, noTitle: true })
    await expect(h.runner.run(request({ surface: true, title: '任务 T1 · X' }))).resolves.toEqual({
      sessionId: 'task-t1-abc',
      timedOut: false,
    })
    expect(h.warnings).toEqual([])
  })
})

describe('execution session composition', () => {
  it('composes every run from the roster default and records it on the header', async () => {
    const h = harness()
    await h.runner.run(request())
    expect(h.presetRequests).toEqual([undefined])
    expect(h.mounts.map((mount) => mount.presetId)).toEqual(['standard'])
    expect(h.created[0]?.hasSetup).toBe(true)
    expect(h.created[0]?.meta.agentPreset).toBe('standard')
  })

  it('mounts the configured preset onto the agent own scope', async () => {
    const h = harness()
    await h.runner.run(request({ agentPreset: 'ptc', surface: true, title: '任务 T1 · X' }))
    expect(h.presetRequests).toEqual(['ptc'])
    expect(h.created[0]?.meta.agentPreset).toBe('ptc')
    // The mount target is the scoped context the factory handed to `setup`
    // (the fake attaches the agent to it), not the plugin's own context — that
    // is what makes the composition per-session.
    expect(h.mounts[0]?.agentCtx).toHaveProperty('session', { id: 'task-t1-abc' })
  })

  it('fails the run loudly when the configured preset is unknown', async () => {
    const h = harness({ resolveFails: true })
    await expect(h.runner.run(request({ agentPreset: 'nope' }))).rejects.toThrow('unknown preset')
    // Nothing was published: no tool-less session is left behind.
    expect(h.created).toEqual([])
    expect(h.disposed).toBe(0)
  })

  it('fails the run when the composition itself cannot be mounted', async () => {
    const h = harness({ mountFails: true })
    await expect(h.runner.run(request())).rejects.toThrow('preset exploded')
    expect(h.created[0]?.hasSetup).toBe(true)
    expect(h.disposed).toBe(0)
  })

  it('keeps the host composition in a deployment with no preset roster', async () => {
    const h = harness({ noPresets: true })
    await h.runner.run(request())
    expect(h.created[0]?.meta).toEqual({ cwd: '/repo', origin: 'subagent' })
    expect(h.created[0]?.hasSetup).toBe(false)
    expect(h.mounts).toEqual([])
  })

  it('warns once when a configured preset meets a rosterless deployment', async () => {
    const h = harness({ noPresets: true })
    await h.runner.run(request({ agentPreset: 'ptc' }))
    await h.runner.run(request({ agentPreset: 'ptc' }))
    expect(h.created[0]?.meta).toEqual({ cwd: '/repo', origin: 'subagent' })
    expect(h.warnings.filter((message) => message.includes('已忽略 agentPreset'))).toHaveLength(1)

    // An unconfigured run in the same deployment stays silent.
    const quiet = harness({ noPresets: true })
    await quiet.runner.run(request())
    expect(quiet.warnings).toEqual([])
  })
})
