/**
 * Decomposition-session tests: the confirm tool must start an independent
 * planner session (product document §5.3.1) and report what it stored.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TaskStore } from '../store/repository.ts'
import { DocPaths } from '../docs/paths.ts'
import { GitClient } from '../git/git.ts'
import { OrchestratorService } from '../service.ts'
import type { OrchestratorLogger, RequirementDraftInput } from '../service.ts'
import { Planner } from '../agents/planner.ts'
import type { Workspace } from '../workspace/registry.ts'
import { AgentTimeoutError } from '../agents/session.ts'
import type { AgentRunner } from '../agents/session.ts'
import { requirementConfirmTool } from '../tools/requirement.ts'
import { resolveOptions } from '../domain/config.ts'

const logger: OrchestratorLogger = { info: () => {}, warn: () => {}, error: () => {} }

process.env['GIT_AUTHOR_NAME'] = 'Task Planner Test'
process.env['GIT_AUTHOR_EMAIL'] = 'task@example.test'
process.env['GIT_COMMITTER_NAME'] = 'Task Planner Test'
process.env['GIT_COMMITTER_EMAIL'] = 'task@example.test'

let repo: string

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
}

function draft(): RequirementDraftInput {
  return {
    title: '拆解演示',
    slug: 'plan-demo',
    background: '演示确认后自动拆解。',
    goals: ['确认后自动拆解'],
    nonGoals: [],
    functionalRequirements: [{ title: '拆解', detail: '独立会话完成。' }],
    featureDeltas: [{ op: 'add', domain: '任务拆解', name: '自动拆解', behavior: '确认后启动' }],
    technicalConstraints: 'node:sqlite',
    acceptance: ['确认后产生任务'],
    openQuestions: [],
  }
}

interface Harness {
  service: OrchestratorService
  store: TaskStore
  planner: Planner
  sessions: string[]
}

function harness(agent: AgentRunner, config: Record<string, unknown> = {}): Harness {
  const store = TaskStore.memory()
  const options = resolveOptions({ workspaceRoot: repo, scanIntervalMs: 1000, ...config }, repo)
  const paths = new DocPaths(repo, options.docsRoot, options.systemFeaturesFile)
  const gitClient = new GitClient(repo)
  const service = new OrchestratorService({ store, paths, git: gitClient, options, logger })
  const planner = new Planner({ service, agents: agent, options, logger })
  return { service, store, planner, sessions: [] }
}

function toolContext(): ToolRunContext {
  return { signal: new AbortController().signal } as unknown as ToolRunContext
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'task-planner-'))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
  writeFileSync(join(repo, 'README.md'), '# demo\n')
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'chore: init'])
})

afterEach(() => {
  execFileSync('rm', ['-rf', repo])
})

describe('decomposition session', () => {
  it('stores tasks through the planner session and reports them', async () => {
    const sessions: string[] = []
    const requests: {
      surface?: boolean | undefined
      title?: string | undefined
      agentPreset?: string | undefined
    }[] = []
    const h = harness({
      async run(request) {
        sessions.push(request.sessionId)
        requests.push({
          surface: request.surface,
          title: request.title,
          agentPreset: request.agentPreset,
        })
        expect(request.instructions).toContain('task_plan_create')
        h.service.plan({
          slug: 'plan-demo',
          tasks: [
            { key: 'a', title: '存储层', goal: 'g', acceptance: 'ok' },
            { key: 'b', title: '调度层', goal: 'g', acceptance: 'ok', dependsOn: ['a'] },
          ],
        })
        return { sessionId: request.sessionId, timedOut: false }
      },
    })
    h.service.setHooks({
      askUser: async () => ({ answers: [{ id: 'confirm-requirement', selected: ['确认'] }] }),
    })
    await h.service.draftRequirement(draft(), { agentId: 'a' })
    const tool = requirementConfirmTool(
      () => ({ service: h.service, planner: h.planner }) as unknown as Workspace,
    )
    const result = (await tool.execute({ slug: 'plan-demo' }, toolContext())) as {
      approved: boolean
      decomposition: { sessionId: string; warning: string | null; tasks: { taskId: string }[] }
      instruction: string
    }

    expect(result.approved).toBe(true)
    expect(result.decomposition.warning).toBeNull()
    expect(result.decomposition.tasks.map((task) => task.taskId)).toEqual(['T1', 'T2'])
    expect(result.instruction).toContain('2 个任务')
    expect(sessions).toHaveLength(1)
    // The decomposition session is surfaced like task execution, under its own title.
    expect(requests).toEqual([
      { surface: true, title: '拆解需求 plan-demo', agentPreset: undefined },
    ])
    expect(h.store.listTasks().map((task) => task.status)).toEqual(['pending', 'pending'])
  })

  it('does not plan an already planned requirement again', async () => {
    let runs = 0
    const h = harness({
      async run(request) {
        runs += 1
        return { sessionId: request.sessionId, timedOut: false }
      },
    })
    await h.service.draftRequirement(draft(), { agentId: 'a' })
    h.service.setHooks({
      askUser: async () => ({ answers: [{ id: 'confirm-requirement', selected: ['确认'] }] }),
    })
    await h.service.confirmRequirement({ slug: 'plan-demo' })
    await h.service.plan({
      slug: 'plan-demo',
      tasks: [{ key: 'a', title: '唯一任务', goal: 'g', acceptance: 'ok' }],
    })
    const product = h.store.findProductBySlug('plan-demo')
    expect(product).toBeDefined()

    const first = await h.planner.decompose(product!, new AbortController().signal)
    const second = await h.planner.decompose(product!, new AbortController().signal)
    expect(runs).toBe(0)
    expect(first.tasks.map((task) => task.id)).toEqual(['T1'])
    expect(second.tasks.map((task) => task.id)).toEqual(['T1'])
    expect(h.store.listTasks()).toHaveLength(1)
  })

  it('reports a warning when the session fails instead of throwing', async () => {
    const h = harness({
      run() {
        return Promise.reject(new AgentTimeoutError(5000))
      },
    })
    await h.service.draftRequirement(draft(), { agentId: 'a' })
    h.service.setHooks({
      askUser: async () => ({ answers: [{ id: 'confirm-requirement', selected: ['确认'] }] }),
    })
    await h.service.confirmRequirement({ slug: 'plan-demo' })
    const product = h.store.findProductBySlug('plan-demo')
    const result = await h.planner.decompose(product!, new AbortController().signal)

    expect(result.tasks).toEqual([])
    expect(result.warning).toContain('5000ms')
    // The confirmation itself already committed, so it must still stand.
    expect(h.store.findProductBySlug('plan-demo')?.status).toBe('confirmed')
    expect(h.store.listTasks()).toHaveLength(0)
  })

  it('warns when the session finished without creating tasks', async () => {
    const h = harness({
      run(request) {
        return Promise.resolve({ sessionId: request.sessionId, timedOut: false })
      },
    })
    await h.service.draftRequirement(draft(), { agentId: 'a' })
    h.service.setHooks({
      askUser: async () => ({ answers: [{ id: 'confirm-requirement', selected: ['确认'] }] }),
    })
    await h.service.confirmRequirement({ slug: 'plan-demo' })
    const product = h.store.findProductBySlug('plan-demo')
    const result = await h.planner.decompose(product!, new AbortController().signal)
    expect(result.warning).toContain('没有创建任何任务')
  })

  it('composes the session from the configured agent preset', async () => {
    const seen: (string | undefined)[] = []
    const h = harness(
      {
        run(request) {
          seen.push(request.agentPreset)
          return Promise.resolve({ sessionId: request.sessionId, timedOut: false })
        },
      },
      { agentPreset: 'ptc' },
    )
    await h.service.draftRequirement(draft(), { agentId: 'a' })
    h.service.setHooks({
      askUser: async () => ({ answers: [{ id: 'confirm-requirement', selected: ['确认'] }] }),
    })
    await h.service.confirmRequirement({ slug: 'plan-demo' })
    const product = h.store.findProductBySlug('plan-demo')
    await h.planner.decompose(product!, new AbortController().signal)
    expect(seen).toEqual(['ptc'])
  })
})
