/**
 * Execution-session tests.
 *
 * A task run must be watchable from the frontend: the session is created as an
 * ordinary conversation (no `origin: 'subagent'`), titled, and attached to the
 * workspace owning its repository. Internal runs (decomposition) stay hidden,
 * and no surfacing failure may ever fail the run itself.
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
}

interface Harness {
  runner: ReturnType<typeof createDshAgentRunner>
  created: CreateCall[]
  renamed: { sessionId: string; title: string }[]
  attach: { path: string; sessionId: string }[]
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
}

function harness(options: FakeOptions = {}): Harness {
  const created: CreateCall[] = []
  const renamed: { sessionId: string; title: string }[] = []
  const attach: { path: string; sessionId: string }[] = []
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
      return undefined
    },
    agents: {
      create: async (call: {
        sessionId: SessionId
        meta: Record<string, unknown>
        signal?: AbortSignal
      }) => {
        created.push({
          sessionId: call.sessionId,
          meta: call.meta,
          signal: call.signal,
          agentOptions: (call as { agentOptions?: unknown }).agentOptions,
        })
        const agent = {
          session: { id: call.sessionId },
          followup: () => {},
          whenIdle: async (): Promise<void> => {},
          cancel: () => {},
        }
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
    expect(h.created[0]?.meta).toEqual({ cwd: '/repo', origin: 'subagent' })
    expect(h.renamed).toEqual([])
    expect(h.attach).toEqual([])
  })

  it('creates a surfaced run as an ordinary session and titles it', async () => {
    const h = harness({ existingWorkspace: true })
    await h.runner.run(request({ surface: true, title: '任务 T1 · 邀请链接结构' }))
    expect(h.created[0]?.meta).toEqual({ cwd: '/repo' })
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
