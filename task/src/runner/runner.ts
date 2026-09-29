/**
 * Single-task executor.
 *
 * One run is: preflight → isolated model session → independent verification →
 * exactly one commit → `done`. The executor never trusts the model's own
 * completion claim: a task only becomes `done` after the worktree, the commit,
 * and the declared verification commands check out.
 */

import { randomUUID } from 'node:crypto'
import { GitClient } from '../git/git.ts'
import { OrchestratorService } from '../service.ts'
import type { OrchestratorLogger } from '../service.ts'
import { AgentTimeoutError } from '../agents/session.ts'
import type { AgentRunner } from '../agents/session.ts'
import { executorInstructions } from '../agents/prompts.ts'
import type { TaskOrchestratorOptions } from '../domain/config.ts'
import { describeError } from '../domain/errors.ts'
import type { FailureKind, TaskRunOutcome } from '../domain/types.ts'

/** Collaborators of the executor. */
export interface TaskRunnerDeps {
  service: OrchestratorService
  agents: AgentRunner
  git: GitClient
  logger: OrchestratorLogger
  options: TaskOrchestratorOptions
}

/** Executes one scheduler-selected task. */
export class TaskRunner {
  private readonly service: OrchestratorService
  private readonly agents: AgentRunner
  private readonly git: GitClient
  private readonly logger: OrchestratorLogger
  private readonly options: TaskOrchestratorOptions

  constructor(deps: TaskRunnerDeps) {
    this.service = deps.service
    this.agents = deps.agents
    this.git = deps.git
    this.logger = deps.logger
    this.options = deps.options
  }

  /**
   * Run one task to a terminal outcome.
   * @param taskId - task to execute.
   * @param signal - plugin-wide cancellation signal.
   * @returns what happened, for the scheduler's loop decision.
   */
  async run(taskId: string, signal: AbortSignal): Promise<TaskRunOutcome> {
    const task = this.service.store.getTask(taskId)
    if (task === undefined)
      return { kind: 'failed', failure: 'spec', message: `任务不存在：${taskId}`, retryable: false }
    if (task.status !== 'pending') {
      return {
        kind: 'failed',
        failure: 'spec',
        message: `任务 ${taskId} 当前为 ${task.status}`,
        retryable: false,
      }
    }

    // ---- preflight (before anything is written, so the worktree check is honest)
    if (!(await this.git.isRepository())) {
      return await this.fail(
        taskId,
        'git',
        `${this.git.root} 不是 git 仓库，无法提交任务产出`,
        false,
      )
    }
    if (this.options.requireCleanWorktree && !(await this.git.isClean())) {
      const dirty = await this.git.changedPaths()
      return await this.fail(
        taskId,
        'git',
        `工作区存在未提交改动（${dirty.slice(0, 5).join('、') || '未知'}），拒绝执行以免把无关改动混入任务提交`,
        false,
      )
    }
    const headBefore = await this.git.head()
    const branch = await this.git.currentBranch()

    // ---- start
    const sessionLabel = task.id.toLowerCase()
    const sessionId = `task-${sessionLabel}-${randomUUID()}`
    try {
      this.service.beginTask(taskId, sessionId)
    } catch (error) {
      return await this.fail(taskId, 'spec', describeError(error), false)
    }

    this.logger.info(
      `task-orchestrator: 开始执行 ${task.id}（分支 ${branch ?? 'detached'}，第 ${String(task.attempt + 1)} 次尝试）`,
    )

    try {
      const run = await this.agents.run({
        label: sessionLabel,
        instructions: executorInstructions(task, { docsRoot: this.options.docsRoot }),
        cwd: this.options.workspaceRoot,
        sessionId,
        timeoutMs: this.options.taskTimeoutMs,
        signal,
      })
      if (run.timedOut) {
        return await this.fail(
          taskId,
          'timeout',
          `任务执行超过 ${String(this.options.taskTimeoutMs)}ms`,
          true,
        )
      }
    } catch (error) {
      if (error instanceof AgentTimeoutError) {
        return await this.fail(taskId, 'timeout', describeError(error), true)
      }
      const interrupted = signal.aborted
      return await this.fail(
        taskId,
        interrupted ? 'interrupted' : 'model',
        describeError(error),
        !interrupted,
      )
    }

    // The session may have reported its own failure through `task_progress`.
    const afterSession = this.service.store.getTask(taskId)
    if (afterSession === undefined) {
      return {
        kind: 'failed',
        failure: 'spec',
        message: `任务 ${taskId} 在执行中消失`,
        retryable: false,
      }
    }
    if (afterSession.status === 'failed') {
      return await this.fail(
        taskId,
        (afterSession.errorKind as FailureKind | null) ?? 'model',
        afterSession.errorMessage ?? '任务自行上报失败',
        false,
      )
    }
    if (afterSession.status === 'blocked') {
      return await this.fail(
        taskId,
        'spec',
        afterSession.blockedReason ?? '任务自行上报阻塞',
        false,
      )
    }

    // ---- verification
    for (const command of afterSession.verifyCommands) {
      const result = await this.git.verify(command, this.options.taskTimeoutMs)
      if (!result.ok) {
        const detail = (result.stderr || result.stdout)
          .split('\n')
          .slice(0, 3)
          .join(' ')
          .slice(0, 400)
        return await this.fail(
          taskId,
          'verification',
          `验证命令失败：\`${command}\` → ${detail}`,
          false,
        )
      }
    }

    const headAfter = await this.git.head()
    // The task document is rewritten with `执行中` before the session starts, so
    // that single file never counts as work product.
    const ownDocument = afterSession.documentPath
    const otherChanges = (await this.git.changedPaths()).filter((path) => path !== ownDocument)
    if (headAfter === headBefore && otherChanges.length === 0) {
      return await this.fail(
        taskId,
        'verification',
        '任务执行后没有任何改动，也没有新的提交',
        false,
      )
    }

    // ---- exactly one commit for this task
    const message = this.commitMessage(afterSession.id, afterSession.title)
    let finished: Awaited<ReturnType<OrchestratorService['finishTask']>>
    try {
      finished = await this.service.finishTask(taskId, message, {
        amend: headAfter !== null && headAfter !== headBefore,
      })
    } catch (error) {
      // Any收尾 failure must not leave the task stuck in `running`.
      return await this.fail(taskId, 'git', `任务收尾失败：${describeError(error)}`, true)
    }
    if (!finished.ok) {
      return await this.fail(taskId, 'git', `任务提交失败：${finished.message}`, true)
    }
    this.logger.info(`task-orchestrator: 任务 ${taskId} 完成（${finished.commit.slice(0, 8)}）`)
    return { kind: 'done', commit: finished.commit }
  }

  private commitMessage(id: string, title: string): string {
    return this.options.commitMessageTemplate.replace(/\{id\}/gu, id).replace(/\{title\}/gu, title)
  }

  private async fail(
    taskId: string,
    failure: FailureKind,
    message: string,
    retryable: boolean,
  ): Promise<TaskRunOutcome> {
    try {
      const result = await this.service.failTask(taskId, { kind: failure, message, retryable })
      return { kind: 'failed', failure, message, retryable: result.retrying }
    } catch (error) {
      this.logger.error(`task-orchestrator: 记录 ${taskId} 失败时出错：${describeError(error)}`)
      return { kind: 'failed', failure, message, retryable: false }
    }
  }
}
