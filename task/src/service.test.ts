/**
 * End-to-end workflow test over a real (temporary) git repository:
 * clarify → confirm → feature overview → decompose → schedule → commit.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TaskStore } from './store/repository.ts'
import { DocPaths } from './docs/paths.ts'
import { GitClient } from './git/git.ts'
import { OrchestratorService } from './service.ts'
import type { OrchestratorLogger } from './service.ts'
import { TaskRunner } from './runner/runner.ts'
import { Scheduler } from './scheduler/scheduler.ts'
import { resolveOptions } from './domain/config.ts'
import { AgentTimeoutError } from './agents/session.ts'
import type { AgentRunner } from './agents/session.ts'
import type { RequirementDraftInput } from './service.ts'

const logger: OrchestratorLogger = { info: () => {}, warn: () => {}, error: () => {} }

process.env['GIT_AUTHOR_NAME'] = 'Task Orchestrator Test'
process.env['GIT_AUTHOR_EMAIL'] = 'task@example.test'
process.env['GIT_COMMITTER_NAME'] = 'Task Orchestrator Test'
process.env['GIT_COMMITTER_EMAIL'] = 'task@example.test'

let repo: string

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
}

function draft(overrides: Partial<RequirementDraftInput> = {}): RequirementDraftInput {
  return {
    title: '任务编排插件',
    slug: 'task-orchestrator',
    background: '把一句话需求变成可执行的排期任务。',
    goals: ['需求闭环后生成文档', '拆解为有依赖的任务并自动执行'],
    nonGoals: ['不做可视化甘特图'],
    functionalRequirements: [{ title: '需求梳理', detail: '不闭环不写码。' }],
    featureDeltas: [
      {
        op: 'add',
        domain: '需求梳理',
        name: '澄清循环',
        behavior: '未知事实必须提问',
        state: '待实现',
      },
      {
        op: 'add',
        domain: '调度与执行',
        name: '串行调度',
        behavior: '一次只执行一个任务',
        state: '待实现',
      },
    ],
    technicalConstraints: 'node:sqlite 存储，串行执行，不使用 worktree。',
    acceptance: ['可执行任务在扫描后被执行', '每个任务一次独立提交'],
    openQuestions: [],
    ...overrides,
  }
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'task-orchestrator-'))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
  writeFileSync(join(repo, 'README.md'), '# demo\n')
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'chore: init'])
})

afterEach(() => {
  execFileSync('rm', ['-rf', repo])
})

interface Harness {
  store: TaskStore
  service: OrchestratorService
  scheduler: Scheduler
  runner: TaskRunner
  paths: DocPaths
  git: GitClient
}

function harness(agent: AgentRunner, overrides: { maxRetries?: number } = {}): Harness {
  const store = TaskStore.memory()
  const options = resolveOptions(
    {
      workspaceRoot: repo,
      scanIntervalMs: 1000,
      ...(overrides.maxRetries === undefined ? {} : { maxRetries: overrides.maxRetries }),
    },
    repo,
  )
  const paths = new DocPaths(repo, options.docsRoot, options.systemFeaturesFile)
  const gitClient = new GitClient(repo)
  const service = new OrchestratorService({ store, paths, git: gitClient, options, logger })
  const runner = new TaskRunner({ service, agents: agent, git: gitClient, logger, options })
  const scheduler = new Scheduler({ service, runner, logger, options, enableTimer: false })
  return { store, service, scheduler, runner, paths, git: gitClient }
}

/** Agent stub that performs the task's work and reports success. */
function workingAgent(work: (sessionId: string) => void = () => undefined): AgentRunner {
  return {
    async run(request) {
      work(request.sessionId)
      return { sessionId: request.sessionId, timedOut: false }
    },
  }
}

describe('requirement → decomposition → execution', () => {
  it('asks the user until the requirement is closed, then waits for confirmation', async () => {
    const asked: string[] = []
    const h = harness(workingAgent())
    h.service.setHooks({
      askUser: async (request) => {
        asked.push(...request.questions.map((question) => question.question))
        return { answers: [{ id: 'q1', selected: [], custom: '面向单仓库的开发者' }] }
      },
    })

    const first = await h.service.draftRequirement(
      draft({
        openQuestions: [{ id: 'q1', question: '目标用户是谁？' }],
      }),
      { agentId: 'analyst-1' },
    )
    expect(first.closed).toBe(false)
    expect(first.status).toBe('draft')
    expect(asked).toEqual(['目标用户是谁？'])
    expect(first.answers[0]?.custom).toBe('面向单仓库的开发者')
    // Nothing is written before the requirement closes.
    expect(existsSync(h.paths.productDoc('task-orchestrator'))).toBe(false)
    expect(h.store.listProducts()).toHaveLength(0)

    const headBefore = git(['rev-parse', 'HEAD'])
    const closed = await h.service.draftRequirement(draft(), { agentId: 'analyst-1' })
    expect(closed.closed).toBe(true)
    expect(closed.status).toBe('pending_confirmation')
    expect(existsSync(h.paths.productDoc('task-orchestrator'))).toBe(true)
    expect(readFileSync(h.paths.productDoc('task-orchestrator'), 'utf8')).toContain(
      '本次需求带来的功能更新点',
    )
    // Acceptance #2: no commit, no tasks, no feature overview before confirmation.
    expect(git(['rev-parse', 'HEAD'])).toBe(headBefore)
    expect(h.store.listTasks()).toHaveLength(0)
    expect(existsSync(h.paths.systemFeaturesPath)).toBe(false)
  })

  it('refuses to run decomposition before the user confirms', async () => {
    const h = harness(workingAgent())
    await h.service.draftRequirement(draft(), { agentId: 'analyst-1' })
    await expect(
      h.service.plan({
        slug: 'task-orchestrator',
        tasks: [{ key: 'a', title: 'A', goal: 'g', acceptance: 'a' }],
      }),
    ).rejects.toThrowError(/尚未确认/u)
  })

  it('merges the feature overview and commits both documents on confirmation', async () => {
    const h = harness(workingAgent())
    h.service.setHooks({
      askUser: async () => ({ answers: [{ id: 'confirm-requirement', selected: ['确认'] }] }),
    })
    await h.service.draftRequirement(draft(), { agentId: 'analyst-1' })
    const result = await h.service.confirmRequirement({ slug: 'task-orchestrator' })

    expect(result.approved).toBe(true)
    expect(result.changes).toBe(2)
    expect(result.commit).not.toBeNull()
    const overview = readFileSync(h.paths.systemFeaturesPath, 'utf8')
    expect(overview).toContain('## 功能域：需求梳理')
    expect(overview).toContain('### 澄清循环')
    expect(overview).toContain('- 状态：待实现')
    // One commit containing both documents (acceptance #3).
    const files = git(['show', '--name-only', '--pretty=format:', 'HEAD'])
      .split('\n')
      .filter(Boolean)
    expect(files).toContain('docs/products/task-orchestrator.md')
    expect(files).toContain('docs/products/system-features.md')
    expect(git(['status', '--porcelain'])).toBe('')
  })

  it('rejects cyclic decompositions without writing anything', async () => {
    const h = harness(workingAgent())
    h.service.setHooks({
      askUser: async () => ({ answers: [{ id: 'confirm-requirement', selected: ['确认'] }] }),
    })
    await h.service.draftRequirement(draft(), { agentId: 'a' })
    await h.service.confirmRequirement({ slug: 'task-orchestrator' })
    await expect(
      h.service.plan({
        slug: 'task-orchestrator',
        tasks: [
          { key: 'a', title: 'A', goal: 'g', acceptance: 'ok', dependsOn: ['b'] },
          { key: 'b', title: 'B', goal: 'g', acceptance: 'ok', dependsOn: ['a'] },
        ],
      }),
    ).rejects.toThrowError(/存在环/u)
    expect(h.store.listTasks()).toHaveLength(0)
  })

  it('stores tasks without executing them, then runs the whole chain serially', async () => {
    const sessions: string[] = []
    const h = harness(
      workingAgent((sessionId) => {
        sessions.push(sessionId)
        writeFileSync(join(repo, `${sessionId}.txt`), sessionId)
      }),
    )
    h.service.setHooks({
      askUser: async () => ({ answers: [{ id: 'confirm-requirement', selected: ['确认'] }] }),
    })
    await h.service.draftRequirement(draft(), { agentId: 'a' })
    await h.service.confirmRequirement({ slug: 'task-orchestrator' })

    const planned = await h.service.plan({
      slug: 'task-orchestrator',
      tasks: [
        { key: 'a', title: '先做存储', goal: '落库', acceptance: '能写入', verifyCommands: [] },
        { key: 'b', title: '再做调度', goal: '调度', acceptance: '能调度', dependsOn: ['a'] },
      ],
    })
    expect(planned.tasks).toHaveLength(2)
    // Stored as pending — decomposition never executes (acceptance #3).
    expect(planned.tasks.map((task) => task.status)).toEqual(['pending', 'pending'])
    expect(h.store.executableTasks().map((task) => task.id)).toEqual(['T1'])
    const commitsAfterPlan = git(['rev-list', '--count', 'HEAD'])

    // One scheduler trigger drains the whole dependency chain.
    h.scheduler.trigger('test')
    await h.scheduler.drain()

    const tasks = h.store.listTasks()
    expect(tasks.map((task) => task.status)).toEqual(['done', 'done'])
    expect(tasks[0]?.commit).toBeTruthy()
    expect(tasks[1]?.commit).toBeTruthy()
    expect(tasks[0]?.commit).not.toBe(tasks[1]?.commit)
    // Two tasks → exactly two new commits, each naming its task id.
    expect(Number(git(['rev-list', '--count', 'HEAD'])) - Number(commitsAfterPlan)).toBe(2)
    const subjects = git(['log', '--pretty=%s', '-2'])
    expect(subjects).toContain('feat(T1): 先做存储')
    expect(subjects).toContain('feat(T2): 再做调度')
    expect(git(['status', '--porcelain'])).toBe('')
    expect(sessions).toHaveLength(2)

    // The feature overview advanced to 已实现 with the task ids (acceptance #13).
    const overview = readFileSync(h.paths.systemFeaturesPath, 'utf8')
    expect(overview).toContain('- 状态：已实现')
    expect(overview).toContain('T1')
    expect(overview).toContain('T2')
  })

  it('blocks downstream tasks when a task exhausts its retries, and releases them on retry', async () => {
    let fail = true
    const agent: AgentRunner = {
      async run(request) {
        if (fail) throw new Error('模型会话崩溃')
        writeFileSync(join(repo, `${request.sessionId}.txt`), 'ok')
        return { sessionId: request.sessionId, timedOut: false }
      },
    }
    const h = harness(agent, { maxRetries: 0 })
    h.service.setHooks({
      askUser: async () => ({ answers: [{ id: 'confirm-requirement', selected: ['确认'] }] }),
    })
    await h.service.draftRequirement(draft(), { agentId: 'a' })
    await h.service.confirmRequirement({ slug: 'task-orchestrator' })
    await h.service.plan({
      slug: 'task-orchestrator',
      tasks: [
        { key: 'a', title: '会失败的任务', goal: 'g', acceptance: 'a' },
        { key: 'b', title: '下游任务', goal: 'g', acceptance: 'a', dependsOn: ['a'] },
      ],
    })

    h.scheduler.trigger('test')
    await h.scheduler.drain()

    const failed = h.store.getTask('T1')
    const blocked = h.store.getTask('T2')
    expect(failed?.status).toBe('failed')
    expect(failed?.errorKind).toBe('model')
    expect(blocked?.status).toBe('blocked')
    expect(blocked?.blockedReason).toBe('blocked_by T1')
    // Acceptance #10: the panel has an actionable notification.
    const notifications = h.store.listNotifications()
    expect(notifications).toHaveLength(1)
    expect(notifications[0]?.kind).toBe('failed')
    expect(notifications[0]?.taskId).toBe('T1')

    // Human retry releases the downstream task and re-runs it successfully.
    fail = false
    await h.service.retryTask('T1', '人工修复后重试')
    expect(h.store.getTask('T2')?.status).toBe('pending')
    h.scheduler.trigger('manual-retry')
    await h.scheduler.drain()
    expect(h.store.getTask('T1')?.status).toBe('done')
    expect(h.store.getTask('T2')?.status).toBe('done')
    expect(h.store.listNotifications()).toHaveLength(0)
  })

  it('classifies a session timeout as a timeout failure', async () => {
    const agent: AgentRunner = {
      run() {
        return Promise.reject(new AgentTimeoutError(1000))
      },
    }
    const h = harness(agent, { maxRetries: 0 })
    h.service.setHooks({
      askUser: async () => ({ answers: [{ id: 'confirm-requirement', selected: ['确认'] }] }),
    })
    await h.service.draftRequirement(draft(), { agentId: 'a' })
    await h.service.confirmRequirement({ slug: 'task-orchestrator' })
    await h.service.plan({
      slug: 'task-orchestrator',
      tasks: [{ key: 'a', title: '超时任务', goal: 'g', acceptance: 'a' }],
    })
    h.scheduler.trigger('test')
    await h.scheduler.drain()
    expect(h.store.getTask('T1')?.status).toBe('failed')
    expect(h.store.getTask('T1')?.errorKind).toBe('timeout')
    expect(h.store.listNotifications()[0]?.message).toContain('timeout')
  })

  it('skips a task and lets the downstream run anyway', async () => {
    const h = harness(
      workingAgent((sessionId) => writeFileSync(join(repo, `${sessionId}.txt`), 'x')),
    )
    h.service.setHooks({
      askUser: async () => ({ answers: [{ id: 'confirm-requirement', selected: ['确认'] }] }),
    })
    await h.service.draftRequirement(draft(), { agentId: 'a' })
    await h.service.confirmRequirement({ slug: 'task-orchestrator' })
    await h.service.plan({
      slug: 'task-orchestrator',
      tasks: [
        { key: 'a', title: '可选任务', goal: 'g', acceptance: 'a' },
        { key: 'b', title: '下游任务', goal: 'g', acceptance: 'a', dependsOn: ['a'] },
      ],
    })
    await h.service.skipTask('T1', '不再需要')
    expect(h.store.getTask('T1')?.status).toBe('cancelled')
    h.scheduler.trigger('manual-skip')
    await h.scheduler.drain()
    expect(h.store.getTask('T2')?.status).toBe('done')
  })

  it('fails a task whose session produced no changes at all', async () => {
    const h = harness(workingAgent())
    h.service.setHooks({
      askUser: async () => ({ answers: [{ id: 'confirm-requirement', selected: ['确认'] }] }),
    })
    await h.service.draftRequirement(draft(), { agentId: 'a' })
    await h.service.confirmRequirement({ slug: 'task-orchestrator' })
    await h.service.plan({
      slug: 'task-orchestrator',
      tasks: [{ key: 'a', title: '空跑任务', goal: 'g', acceptance: 'a' }],
    })
    h.scheduler.trigger('test')
    await h.scheduler.drain()
    const task = h.store.getTask('T1')
    expect(task?.status).toBe('failed')
    expect(task?.errorMessage).toContain('没有任何改动')
    // Only the orchestrator-owned task document was touched, and it is restored.
    expect(git(['status', '--porcelain'])).not.toContain('docs/tasks/T1')
  })

  it('refuses to execute when the worktree is dirty', async () => {
    const h = harness(
      workingAgent((sessionId) => writeFileSync(join(repo, `${sessionId}.txt`), 'x')),
    )
    h.service.setHooks({
      askUser: async () => ({ answers: [{ id: 'confirm-requirement', selected: ['确认'] }] }),
    })
    await h.service.draftRequirement(draft(), { agentId: 'a' })
    await h.service.confirmRequirement({ slug: 'task-orchestrator' })
    await h.service.plan({
      slug: 'task-orchestrator',
      tasks: [{ key: 'a', title: '唯一任务', goal: 'g', acceptance: 'a' }],
    })
    writeFileSync(join(repo, 'user-notes.txt'), '未提交的用户改动')

    h.scheduler.trigger('test')
    await h.scheduler.drain()

    const task = h.store.getTask('T1')
    expect(task?.status).toBe('failed')
    expect(task?.errorKind).toBe('git')
    expect(task?.errorMessage).toContain('未提交改动')
    // The user's file was never committed (acceptance #12).
    expect(git(['status', '--porcelain'])).toContain('user-notes.txt')
  })

  it('recovers a task left running by a previous process', async () => {
    const h = harness(
      workingAgent((sessionId) => writeFileSync(join(repo, `${sessionId}.txt`), 'x')),
    )
    h.service.setHooks({
      askUser: async () => ({ answers: [{ id: 'confirm-requirement', selected: ['确认'] }] }),
    })
    await h.service.draftRequirement(draft(), { agentId: 'a' })
    await h.service.confirmRequirement({ slug: 'task-orchestrator' })
    const planned = await h.service.plan({
      slug: 'task-orchestrator',
      tasks: [{ key: 'a', title: '中断任务', goal: 'g', acceptance: 'a' }],
    })
    // Simulate a crash: an attempt started, then the process died.
    h.service.beginTask(planned.tasks[0]!.id, 'dead-session')
    expect(h.store.listAttempts('T1')).toHaveLength(1)

    const recovered = await h.service.recoverInterrupted()
    expect(recovered).toHaveLength(1)
    // Restarted with the same id and document; a new attempt is recorded on the
    // next execution (acceptance #9).
    expect(recovered[0]?.id).toBe('T1')
    expect(recovered[0]?.status).toBe('pending')
    expect(h.store.getTask('T1')?.documentPath).toBe(planned.tasks[0]?.documentPath)
    expect(h.store.listAttempts('T1')[0]?.errorKind).toBe('interrupted')
    h.scheduler.trigger('after-recovery')
    await h.scheduler.drain()
    expect(h.store.getTask('T1')?.status).toBe('done')
    // The restarted run is a new attempt on the same task id.
    expect(h.store.getTask('T1')?.attempt).toBe(2)
  })

  it('merges a second requirement into the overview incrementally', async () => {
    const h = harness(workingAgent())
    h.service.setHooks({
      askUser: async () => ({ answers: [{ id: 'confirm-requirement', selected: ['确认'] }] }),
    })
    await h.service.draftRequirement(draft(), { agentId: 'a' })
    await h.service.confirmRequirement({ slug: 'task-orchestrator' })
    const firstOverview = readFileSync(h.paths.systemFeaturesPath, 'utf8')

    await h.service.draftRequirement(
      draft({
        title: '通知面板',
        slug: 'panel',
        featureDeltas: [
          { op: 'add', domain: '失败处理', name: '悬浮通知', behavior: '失败任务显示在面板上' },
        ],
      }),
      { agentId: 'b' },
    )
    await h.service.confirmRequirement({ slug: 'panel' })

    const overview = readFileSync(h.paths.systemFeaturesPath, 'utf8')
    expect(overview).toContain('- 覆盖需求：task-orchestrator、panel')
    expect(overview).toContain('### 悬浮通知')
    // The earlier entries keep their original text (acceptance #4).
    expect(overview).toContain('- 行为描述：未知事实必须提问')
    expect(firstOverview).toContain('- 行为描述：未知事实必须提问')
  })
})
