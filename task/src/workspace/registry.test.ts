/**
 * Workspace resolution: the target repository is the session's working
 * directory, and each root gets its own store, documents, and scheduler.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { WorkspaceRegistry, sessionCwd } from './registry.ts'
import { queryTool } from '../tools/tasks.ts'
import type { OrchestratorLogger } from '../service.ts'
import { normalizeRoot, resolveOptions } from '../domain/config.ts'
import type { AgentRunner } from '../agents/session.ts'

const logger: OrchestratorLogger = { info: () => {}, warn: () => {}, error: () => {} }

const agents: AgentRunner = {
  run(request) {
    return Promise.resolve({ sessionId: request.sessionId, timedOut: false })
  },
}

let first: string
let second: string

function repo(prefix: string): string {
  // Canonicalize like the registry does: macOS maps /var onto /private/var,
  // and one directory must always produce one workspace key.
  const dir = normalizeRoot(mkdtempSync(join(tmpdir(), prefix)))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
  writeFileSync(join(dir, 'README.md'), '# demo\n')
  return dir
}

function registry(): WorkspaceRegistry {
  return new WorkspaceRegistry({
    options: resolveOptions({ scanIntervalMs: 1000 }, first),
    logger,
    agents,
    enableScheduler: false,
  })
}

beforeEach(() => {
  first = repo('task-ws-a-')
  second = repo('task-ws-b-')
})

afterEach(() => {
  execFileSync('rm', ['-rf', first, second])
})

describe('WorkspaceRegistry', () => {
  it('opens one workspace per session working directory', () => {
    const registryUnderTest = registry()
    const a = registryUnderTest.resolve(first)
    const b = registryUnderTest.resolve(second)
    const again = registryUnderTest.resolve(first)

    expect(a.root).toBe(first)
    expect(b.root).toBe(second)
    expect(again).toBe(a)
    expect(registryUnderTest.list()).toHaveLength(2)
    registryUnderTest.close()
  })

  it('keeps databases and documents inside each workspace', () => {
    const registryUnderTest = registry()
    const a = registryUnderTest.resolve(first)
    const b = registryUnderTest.resolve(second)

    expect(a.options.databasePath).toBe(join(first, '.dsh', 'task-orchestrator.sqlite'))
    expect(b.options.databasePath).toBe(join(second, '.dsh', 'task-orchestrator.sqlite'))
    expect(a.paths.systemFeaturesPath).toBe(join(first, 'docs', 'products', 'system-features.md'))
    expect(b.paths.systemFeaturesPath).toBe(join(second, 'docs', 'products', 'system-features.md'))
    expect(a.git.root).toBe(first)
    expect(b.git.root).toBe(second)
    expect(existsSync(a.options.databasePath)).toBe(true)
    expect(existsSync(join(first, '.dsh'))).toBe(true)
    registryUnderTest.close()
  })

  it('keeps task ids independent per workspace', () => {
    const registryUnderTest = registry()
    const a = registryUnderTest.resolve(first)
    const b = registryUnderTest.resolve(second)
    const productA = a.service.store.createProduct({
      slug: 'demo',
      title: 'A',
      documentPath: 'docs/products/demo.md',
      status: 'confirmed',
      featureDeltas: [],
    })
    expect(a.service.store.reserveTaskIds(1)).toEqual(['T1'])
    expect(b.service.store.reserveTaskIds(1)).toEqual(['T1'])
    expect(b.service.store.listProducts()).toHaveLength(0)
    // The same task id in two workspaces addresses two different tasks.
    b.service.store.createTasks(
      b.service.store.createProduct({
        slug: 'demo',
        title: 'B',
        documentPath: 'docs/products/demo.md',
        status: 'confirmed',
        featureDeltas: [],
      }).id,
      [
        {
          id: 'T1',
          title: 'B 的任务',
          slug: 'b',
          documentPath: 'docs/tasks/T1-b.md',
          acceptance: 'ok',
          verifyCommands: [],
          detail: { goal: 'g', scope: [], risks: '', rollback: '' },
          priority: 100,
          estimate: 'M',
          dependsOn: [],
        },
      ],
    )
    expect(a.service.store.getTask('T1')).toBeUndefined()
    expect(b.service.store.getTask('T1')?.title).toBe('B 的任务')
    expect(productA.id).toBe(1)
    registryUnderTest.close()
  })

  it('falls back to the configured root when a call carries no session directory', () => {
    const registryUnderTest = registry()
    const fallback = registryUnderTest.resolve(undefined)
    expect(fallback.root).toBe(first)
    expect(registryUnderTest.fallbackRoot).toBe(first)
    registryUnderTest.close()
  })

  it('rejects a session directory that does not exist', () => {
    const registryUnderTest = registry()
    expect(() => registryUnderTest.resolve(join(first, 'missing-subdir'))).toThrowError(
      /工作目录不存在/u,
    )
    // `observe` is the non-throwing variant used by session lifecycle hooks.
    expect(registryUnderTest.observe(join(first, 'missing-subdir'))).toBeUndefined()
    expect(registryUnderTest.list()).toHaveLength(0)
    registryUnderTest.close()
  })

  it('closes every database so the registry can be reloaded', () => {
    const registryUnderTest = registry()
    registryUnderTest.resolve(first)
    registryUnderTest.close()
    expect(registryUnderTest.list()).toHaveLength(0)
    expect(() => registryUnderTest.resolve(first)).toThrowError(/已卸载/u)
    // A fresh registry (plugin reload) can reopen the same root.
    const reloaded = registry()
    expect(reloaded.resolve(first).root).toBe(first)
    reloaded.close()
  })
})

/** Minimal tool execution context carrying the calling session's directory. */
function callFrom(cwd: string | undefined): ToolRunContext {
  return {
    signal: new AbortController().signal,
    agent: { session: { header: cwd === undefined ? {} : { cwd } } },
  } as unknown as ToolRunContext
}

describe('tools resolve the workspace from the calling session', () => {
  it('queries each session against its own repository', async () => {
    const registryUnderTest = registry()
    const tool = queryTool((agent) => registryUnderTest.resolve(sessionCwd(agent)))

    const firstResult = (await tool.execute({}, callFrom(first))) as {
      tasks: unknown[]
      counts: Record<string, number>
    }
    expect(firstResult.tasks).toHaveLength(0)

    // A task created in the first workspace is invisible to the second.
    const workspaceA = registryUnderTest.resolve(first)
    const product = workspaceA.service.store.createProduct({
      slug: 'demo',
      title: 'A',
      documentPath: 'docs/products/demo.md',
      status: 'confirmed',
      featureDeltas: [],
    })
    workspaceA.service.store.createTasks(product.id, [
      {
        id: 'T1',
        title: 'A 的任务',
        slug: 'a',
        documentPath: 'docs/tasks/T1-a.md',
        acceptance: 'ok',
        verifyCommands: [],
        detail: { goal: 'g', scope: [], risks: '', rollback: '' },
        priority: 100,
        estimate: 'M',
        dependsOn: [],
      },
    ])

    const secondResult = (await tool.execute({}, callFrom(second))) as { tasks: unknown[] }
    const firstAgain = (await tool.execute({}, callFrom(first))) as { tasks: { taskId: string }[] }
    expect(secondResult.tasks).toHaveLength(0)
    expect(firstAgain.tasks.map((task) => task.taskId)).toEqual(['T1'])
    registryUnderTest.close()
  })

  it('reports an actionable error when the session directory is unusable', async () => {
    const registryUnderTest = registry()
    const tool = queryTool((agent) => registryUnderTest.resolve(sessionCwd(agent)))
    await expect(tool.execute({}, callFrom(join(first, 'nope')))).rejects.toThrowError(
      /工作目录不存在/u,
    )
    registryUnderTest.close()
  })
})

describe('sessionCwd', () => {
  it('reads the validated working directory of the calling session', () => {
    expect(sessionCwd(undefined)).toBeUndefined()
    expect(
      sessionCwd({
        session: { header: { cwd: '/tmp/example' } },
      } as unknown as Parameters<typeof sessionCwd>[0]),
    ).toBe('/tmp/example')
    expect(
      sessionCwd({
        session: { header: {} },
      } as unknown as Parameters<typeof sessionCwd>[0]),
    ).toBeUndefined()
  })
})
