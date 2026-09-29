/**
 * Workspace registry.
 *
 * Every artifact of this plugin (database, documents, git operations, task
 * sessions) belongs to a *workspace root*: the working directory of the session
 * that invoked the tool. The plugin is process-wide, so this registry maps each
 * session working directory onto its own lazily-created context — store,
 * documents, git, domain service, executor, planner, and scheduler — and keeps
 * one scheduler running per opened workspace.
 */

import { statSync } from 'node:fs'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { TaskStore } from '../store/repository.ts'
import { DocPaths } from '../docs/paths.ts'
import { GitClient } from '../git/git.ts'
import { OrchestratorService } from '../service.ts'
import type { AskRequest, OrchestratorHooks, OrchestratorLogger } from '../service.ts'
import { TaskRunner } from '../runner/runner.ts'
import { Planner } from '../agents/planner.ts'
import type { AgentRunner } from '../agents/session.ts'
import { Scheduler } from '../scheduler/scheduler.ts'
import { DomainError } from '../domain/errors.ts'
import { normalizeRoot, optionsForRoot } from '../domain/config.ts'
import type { TaskOrchestratorOptions } from '../domain/config.ts'

/** One opened workspace and every collaborator bound to it. */
export interface Workspace {
  root: string
  options: TaskOrchestratorOptions
  store: TaskStore
  paths: DocPaths
  git: GitClient
  service: OrchestratorService
  runner: TaskRunner
  planner: Planner
  scheduler: Scheduler
}

/** Resolves the workspace a call belongs to, from the calling agent. */
export type WorkspaceResolver = (agent: Agent | undefined) => Workspace

/** Collaborators shared by every workspace. */
export interface WorkspaceRegistryDeps {
  options: TaskOrchestratorOptions
  logger: OrchestratorLogger
  agents: AgentRunner
  /** Interactive question channel forwarded to every workspace service. */
  askUser?: (
    request: AskRequest,
  ) => Promise<{ answers: { id: string; selected: string[]; custom?: string }[] }>
  /** Test seam: keep schedulers from starting their periodic timer. */
  enableScheduler?: boolean
}

/**
 * Read the working directory of the session that issued a call.
 * @param agent - calling agent, when the call came from an agent turn.
 * @returns the validated absolute session directory, or `undefined`.
 */
export function sessionCwd(agent: Agent | undefined): string | undefined {
  const cwd = agent?.session.header.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
}

/** Lazily-opened, cached workspace contexts. */
export class WorkspaceRegistry {
  private readonly deps: WorkspaceRegistryDeps
  private readonly workspaces = new Map<string, Workspace>()
  private closed = false

  constructor(deps: WorkspaceRegistryDeps) {
    this.deps = deps
  }

  /** Root used when a call carries no session working directory. */
  get fallbackRoot(): string {
    return this.deps.options.workspaceRoot
  }

  /**
   * Resolve (opening on first use) the workspace for one call.
   * @param cwd - session working directory, or `undefined` for the fallback.
   * @returns the workspace context.
   */
  resolve(cwd: string | undefined): Workspace {
    if (this.closed) {
      throw new DomainError('unavailable', 'task-orchestrator 已卸载，无法再处理任务')
    }
    const root = normalizeRoot(cwd ?? this.fallbackRoot)
    const existing = this.workspaces.get(root)
    if (existing !== undefined) return existing
    const workspace = this.open(root)
    this.workspaces.set(root, workspace)
    return workspace
  }

  /**
   * Look up an already opened workspace without creating one.
   * @param root - workspace root.
   */
  find(root: string): Workspace | undefined {
    return this.workspaces.get(normalizeRoot(root))
  }

  /** Every opened workspace, in open order. */
  list(): Workspace[] {
    return [...this.workspaces.values()]
  }

  /** Open one workspace context and start its scheduler. */
  private open(root: string): Workspace {
    const stats = statSync(root, { throwIfNoEntry: false })
    if (stats === undefined || !stats.isDirectory()) {
      throw new DomainError(
        'invalid-argument',
        `会话工作目录不存在或不是目录：${root}；请检查会话的 cwd 或配置 workspaceRoot`,
        { root },
      )
    }
    const options = optionsForRoot(this.deps.options, root)
    const store = TaskStore.open({ databasePath: options.databasePath })
    const paths = new DocPaths(options.workspaceRoot, options.docsRoot, options.systemFeaturesFile)
    const git = new GitClient(options.workspaceRoot)
    const hooks: OrchestratorHooks = {}
    if (this.deps.askUser !== undefined) hooks.askUser = this.deps.askUser
    const service = new OrchestratorService({
      store,
      paths,
      git,
      options,
      logger: this.deps.logger,
      hooks,
    })
    const runner = new TaskRunner({
      service,
      agents: this.deps.agents,
      git,
      logger: this.deps.logger,
      options,
    })
    const planner = new Planner({
      service,
      agents: this.deps.agents,
      options,
      logger: this.deps.logger,
    })
    const scheduler = new Scheduler({
      service,
      runner,
      logger: this.deps.logger,
      options,
      enableTimer: this.deps.enableScheduler ?? true,
    })
    service.setHooks({
      requestScan: (reason, delayMs) =>
        delayMs === undefined ? scheduler.trigger(reason) : scheduler.trigger(reason, delayMs),
    })
    if (options.enableScheduler) scheduler.start()
    this.deps.logger.info(
      `task-orchestrator: 已接管工作区 ${root}（数据库 ${options.databasePath}）`,
    )
    return { root, options, store, paths, git, service, runner, planner, scheduler }
  }

  /**
   * Open a workspace observed outside a call (session lifecycle), ignoring
   * failures: a session that starts in an unusable directory must not break
   * session creation.
   * @param cwd - observed session working directory.
   * @returns the workspace, or `undefined` when it could not be opened.
   */
  observe(cwd: string | undefined): Workspace | undefined {
    try {
      return this.resolve(cwd)
    } catch (error) {
      this.deps.logger.warn(
        `task-orchestrator: 无法接管会话工作区 ${cwd ?? '(未提供)'}：${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return undefined
    }
  }

  /** Stop every scheduler and close every database. */
  close(): void {
    if (this.closed) return
    this.closed = true
    for (const workspace of this.workspaces.values()) {
      workspace.scheduler.dispose()
      workspace.store.close()
    }
    this.workspaces.clear()
  }
}
