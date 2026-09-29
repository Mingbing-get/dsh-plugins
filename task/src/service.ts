/**
 * Orchestrator service: the single place where requirements, tasks, documents,
 * git, and the SQLite store meet. Tools, commands, the scheduler, and the
 * intervention panel are all thin adapters over this class, so every entry
 * point shares one set of invariants.
 *
 * Workflow ownership:
 * - `draftRequirement` runs one clarification round and, once closed, writes
 *   `docs/products/<slug>.md` in `pending_confirmation`.
 * - `confirmRequirement` merges the feature deltas into the system feature
 *   overview, commits both documents, and only then marks the product
 *   `confirmed` (decomposition may start).
 * - `plan` stores tasks and dependencies, renders their documents, and wakes
 *   the scheduler. It never executes anything.
 */

import { readFileSync, rmSync } from 'node:fs'
import { DocPaths } from './docs/paths.ts'
import { readTextIfExists, writeTextFile } from './docs/io.ts'
import {
  applyFeatureDeltas,
  entriesFor,
  readFeatureSummary,
  renderFeatureDigest,
} from './docs/features.ts'
import type { FeatureSummary } from './docs/features.ts'
import { renderRequirementDocument } from './docs/requirement.ts'
import type { RequirementDraft } from './docs/requirement.ts'
import { renderTaskDocument } from './docs/task-doc.ts'
import { GitClient } from './git/git.ts'
import { TaskStore } from './store/repository.ts'
import type { PreparedTask } from './store/repository.ts'
import { DomainError, invalidArgument, notFound } from './domain/errors.ts'
import { validatePlanGraph } from './domain/dag.ts'
import { isSlug, nowIso, resolveSlug, slugify } from './domain/text.ts'
import { TASK_STATUSES } from './domain/status.ts'
import type { TaskOrchestratorOptions } from './domain/config.ts'
import type {
  Estimate,
  FailureKind,
  FeatureDelta,
  OpenQuestion,
  ProductRecord,
  TaskRecord,
  TaskStatus,
} from './domain/types.ts'

/** Leveled logger; cordis' logger is adapted to this shape at wiring time. */
export interface OrchestratorLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

/** One question forwarded to the interactive user-questions service. */
export interface AskRequest {
  questions: {
    id: string
    header?: string
    question: string
    detail?: string
    options?: { label: string; description?: string }[]
  }[]
  signal?: AbortSignal
  agent?: unknown
}

/** The human's answer. */
export interface AskResponse {
  answers: { id: string; selected: string[]; custom?: string }[]
}

/** Side effects the service delegates to its host wiring. */
export interface OrchestratorHooks {
  /** Interactive question channel (`ctx.userQuestions.ask`). */
  askUser?: (request: AskRequest) => Promise<AskResponse>
  /** Wake the scheduler, optionally after a delay (retry backoff). */
  requestScan?: (reason: string, delayMs?: number) => void
  /** Publish a new intervention notification to the client panel. */
  onNotification?: (taskId: string | null) => void
  /** Render a plan/decomposition prompt for the model. */
  onProductConfirmed?: (product: ProductRecord) => void
}

/** Structured requirement draft submitted by the analyst model. */
export interface RequirementDraftInput {
  title: string
  slug?: string
  background: string
  goals: string[]
  nonGoals: string[]
  functionalRequirements: { title: string; detail: string }[]
  featureDeltas: FeatureDelta[]
  technicalConstraints: string
  acceptance: string[]
  openQuestions: OpenQuestion[]
}

/** Result of one clarification round. */
export interface DraftResult {
  slug: string
  productId: number | null
  documentPath: string
  status: 'draft' | 'pending_confirmation'
  closed: boolean
  round: number
  /** Answers received for the previous round's questions. */
  answers: { id: string; selected: string[]; custom?: string }[]
  /** Message the model should act on next. */
  instruction: string
}

/** Result of a confirmation request. */
export interface ConfirmResult {
  approved: boolean
  product: ProductRecord
  commit: string | null
  documentPath: string
  featuresPath: string
  changes: number
  instruction: string
}

/** One task as submitted by the planner. */
export interface PlanTaskInput {
  key: string
  title: string
  slug?: string
  goal: string
  acceptance: string
  scope?: string[]
  dependsOn?: string[]
  estimate?: Estimate
  priority?: number
  verifyCommands?: string[]
  risks?: string
  rollback?: string
}

/** Result of a decomposition request. */
export interface PlanResult {
  productId: number
  slug: string
  tasks: TaskRecord[]
  docsCommit: string | null
  warning: string | null
  instruction: string
}

/** Options for {@link OrchestratorService}. */
export interface ServiceDeps {
  store: TaskStore
  paths: DocPaths
  git: GitClient
  options: TaskOrchestratorOptions
  logger: OrchestratorLogger
  hooks?: OrchestratorHooks
  now?: () => Date
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: '待执行',
  running: '执行中',
  done: '已完成',
  failed: '失败',
  blocked: '阻塞',
  cancelled: '已取消',
}

/** Shared domain facade. */
export class OrchestratorService {
  readonly store: TaskStore
  readonly paths: DocPaths
  readonly git: GitClient
  readonly options: TaskOrchestratorOptions
  readonly logger: OrchestratorLogger

  private hooks: OrchestratorHooks
  private readonly clock: () => Date
  private readonly clarifyRounds = new Map<string, number>()

  constructor(deps: ServiceDeps) {
    this.store = deps.store
    this.paths = deps.paths
    this.git = deps.git
    this.options = deps.options
    this.logger = deps.logger
    this.hooks = deps.hooks ?? {}
    this.clock = deps.now ?? (() => new Date())
  }

  /** Replace the host hooks (scheduler and panel are wired after construction). */
  setHooks(hooks: OrchestratorHooks): void {
    this.hooks = { ...this.hooks, ...hooks }
  }

  private now(): Date {
    return this.clock()
  }

  // ------------------------------------------------------- system features

  /** Read the system feature overview, creating nothing. */
  readFeatures(): {
    path: string
    relativePath: string
    exists: boolean
    summary: FeatureSummary
    digest: string
  } {
    const path = this.paths.systemFeaturesPath
    const content = readTextIfExists(path)
    const summary = readFeatureSummary(content)
    return {
      path,
      relativePath: this.paths.toRelative(path),
      exists: content !== undefined,
      summary,
      digest: renderFeatureDigest(summary),
    }
  }

  /**
   * Incrementally merge feature deltas into the overview.
   * @param slug - owning requirement.
   * @param deltas - changes to apply.
   * @param options - optional audit note.
   */
  applyFeatures(
    slug: string,
    deltas: readonly FeatureDelta[],
    options: { note?: string } = {},
  ): { content: string; changes: number } {
    const path = this.paths.systemFeaturesPath
    const content = readTextIfExists(path)
    const result = applyFeatureDeltas(content, slug, deltas, {
      now: this.now(),
      ...(options.note === undefined ? {} : { note: options.note }),
    })
    writeTextFile(path, result.content)
    return { content: result.content, changes: result.changes.length }
  }

  // ------------------------------------------------------------ requirement

  private clarifyKey(agentId: string | undefined, slug: string): string {
    return `${agentId ?? 'anonymous'}:${slug}`
  }

  /**
   * Submit one clarification round.
   *
   * When questions remain open the service asks the human through the
   * interactive channel and hands the answers back to the model. When the
   * requirement is closed it writes the requirement document and parks the
   * product in `pending_confirmation`.
   * @param input - structured draft.
   * @param context - calling agent identity and cancellation signal.
   */
  async draftRequirement(
    input: RequirementDraftInput,
    context: { agentId?: string; signal?: AbortSignal; agent?: unknown } = {},
  ): Promise<DraftResult> {
    const title = input.title.trim()
    if (title.length === 0) throw invalidArgument('需求标题不能为空')
    const slug = resolveSlug(input.slug, title, 'requirement')
    if (!isSlug(slug)) throw invalidArgument(`slug 必须是 ASCII 短横线短名：${slug}`)
    const documentPath = this.paths.productDoc(slug)
    const relativeDoc = this.paths.toRelative(documentPath)
    const key = this.clarifyKey(context.agentId, slug)
    const round = (this.clarifyRounds.get(key) ?? 0) + 1
    this.clarifyRounds.set(key, round)

    if (input.openQuestions.length > 0) {
      if (round > this.options.maxClarifyRounds) {
        throw new DomainError(
          'round-limit',
          `需求 ${slug} 已提问 ${String(round - 1)} 轮，超过上限 ${String(this.options.maxClarifyRounds)}；请缩小范围或先给出可验收的假设`,
        )
      }
      const ask = this.hooks.askUser
      if (ask === undefined) {
        throw new DomainError('unavailable', '当前环境没有可用的用户问答通道，无法继续澄清需求')
      }
      const response = await ask({
        questions: input.openQuestions.map((question) => ({
          id: question.id,
          header: title,
          question: question.question,
          ...(question.detail === undefined ? {} : { detail: question.detail }),
          ...(question.options === undefined ? {} : { options: question.options }),
        })),
        ...(context.signal === undefined ? {} : { signal: context.signal }),
        ...(context.agent === undefined ? {} : { agent: context.agent }),
      })
      this.store.appendEvent('requirement/clarified', {
        data: { slug, round, questions: input.openQuestions.length },
        now: nowIso(this.now()),
      })
      return {
        slug,
        productId: null,
        documentPath: relativeDoc,
        status: 'draft',
        closed: false,
        round,
        answers: response.answers,
        instruction:
          '把这些答案并入需求事实，重新调用 task_requirement_draft。仍有未知事实就继续给出 openQuestions。',
      }
    }

    // Closure gate: a closed requirement must be actionable and verifiable.
    const missing: string[] = []
    if (input.goals.length === 0) missing.push('目标（goals）')
    if (input.acceptance.length === 0) missing.push('验收标准（acceptance）')
    if (input.featureDeltas.length === 0) missing.push('功能更新点（featureDeltas）')
    if (input.background.trim().length === 0) missing.push('背景（background）')
    if (missing.length > 0) {
      throw invalidArgument(
        `需求尚未闭环：缺少 ${missing.join('、')}。请继续澄清，或先向用户提问后再提交。`,
        { missing },
      )
    }

    const draft: RequirementDraft = {
      title,
      slug,
      background: input.background,
      goals: input.goals,
      nonGoals: input.nonGoals,
      functionalRequirements: input.functionalRequirements,
      featureDeltas: input.featureDeltas,
      technicalConstraints: input.technicalConstraints,
      acceptance: input.acceptance,
      openQuestions: [],
    }
    const existing = this.store.findProductBySlug(slug)
    const createdAt = existing?.createdAt ?? nowIso(this.now())
    const body = renderRequirementDocument(draft, {
      status: 'pending_confirmation（待用户确认）',
      createdAt,
      commit: existing?.commit ?? null,
    })
    const product = this.store.createProduct({
      slug,
      title,
      documentPath: relativeDoc,
      status: 'pending_confirmation',
      featureDeltas: input.featureDeltas,
      documentBody: body,
      now: createdAt,
    })
    writeTextFile(documentPath, body)
    this.logger.info(`task-orchestrator: 需求 ${slug} 已生成文档并等待确认`)
    return {
      slug,
      productId: product.id,
      documentPath: relativeDoc,
      status: 'pending_confirmation',
      closed: true,
      round,
      answers: [],
      instruction:
        `需求已闭环并写入 ${relativeDoc}，状态 pending_confirmation。` +
        `请调用 task_requirement_confirm 请用户确认；未确认前不要拆解、不要创建任务。`,
    }
  }

  /**
   * Confirm a requirement: ask the human, merge the feature overview, commit
   * both documents, then mark the product confirmed.
   * @param input - target product and/or explicit assertion.
   * @param context - calling agent identity and cancellation signal.
   */
  async confirmRequirement(
    input: { productId?: number; slug?: string; confirmed?: boolean },
    context: { signal?: AbortSignal; agent?: unknown } = {},
  ): Promise<ConfirmResult> {
    const product = this.requireProduct(input)
    const featuresPath = this.paths.systemFeaturesPath
    const relativeFeatures = this.paths.toRelative(featuresPath)
    if (product.status !== 'pending_confirmation') {
      throw new DomainError(
        'not-confirmed',
        `需求 ${product.slug} 当前状态为 ${product.status}，只有 pending_confirmation 的需求可以确认`,
        { status: product.status },
      )
    }

    if (this.hooks.askUser !== undefined) {
      const answer = await this.hooks.askUser({
        questions: [
          {
            id: 'confirm-requirement',
            header: `需求确认：${product.title}`,
            question: `是否确认 ${product.slug} 需求文档？确认后将更新系统功能全景并提交 git，然后才开始拆解。`,
            // Reviewers must see the document they are approving, not a summary.
            detail: product.documentBody.slice(0, 6000),
            options: [
              { label: '确认', description: '更新功能全景、提交文档并进入拆解' },
              { label: '需要修改', description: '回到需求梳理继续迭代' },
            ],
          },
        ],
        ...(context.signal === undefined ? {} : { signal: context.signal }),
        ...(context.agent === undefined ? {} : { agent: context.agent }),
      })
      const item = answer.answers.find((entry) => entry.id === 'confirm-requirement')
      const approved = item !== undefined && item.selected.includes('确认')
      if (!approved) {
        this.store.appendEvent('product/declined', {
          productId: product.id,
          data: { slug: product.slug, answers: item ?? null },
        })
        return {
          approved: false,
          product,
          commit: null,
          documentPath: product.documentPath,
          featuresPath: relativeFeatures,
          changes: 0,
          instruction: '用户未确认需求。请按反馈继续 task_requirement_draft 迭代，不要拆解。',
        }
      }
    } else if (input.confirmed !== true) {
      throw new DomainError(
        'not-confirmed',
        '需求确认必须由用户完成：当前环境没有交互问答通道，无法自动确认',
      )
    }

    // ① merge the system feature overview first.
    const applied = this.applyFeatures(product.slug, product.featureDeltas, {
      note: `确认需求 ${product.slug}，写入 ${String(product.featureDeltas.length)} 项功能`,
    })

    // ② commit the requirement document together with the overview.
    const confirmedBody = patchRequirementStatus(
      product.documentBody,
      'confirmed（已确认，等待拆解）',
    )
    writeTextFile(this.paths.productDoc(product.slug), confirmedBody)
    const docRelative = this.paths.toRelative(this.paths.productDoc(product.slug))
    const committed = await this.git.commit(
      `docs(task): 确认 ${product.slug} 需求并更新系统功能全景`,
      [docRelative, relativeFeatures],
    )
    if (!committed.ok) {
      const restored = patchRequirementStatus(
        product.documentBody,
        'pending_confirmation（待用户确认）',
      )
      writeTextFile(this.paths.productDoc(product.slug), restored)
      throw new DomainError('git', `需求确认失败：${committed.message}`, {
        reason: committed.message,
      })
    }

    const updated = this.store.setProductStatus(product.id, 'confirmed', {
      commit: committed.hash,
      confirmedAt: nowIso(this.now()),
      documentBody: confirmedBody,
    })
    this.store.appendEvent('product/confirmed', {
      productId: product.id,
      data: { slug: product.slug, commit: committed.hash, featureChanges: applied.changes },
    })
    this.hooks.onProductConfirmed?.(updated)
    this.logger.info(
      `task-orchestrator: 需求 ${product.slug} 已确认（${committed.hash.slice(0, 8)}）`,
    )
    return {
      approved: true,
      product: updated,
      commit: committed.hash,
      documentPath: product.documentPath,
      featuresPath: relativeFeatures,
      changes: applied.changes,
      instruction:
        `需求已确认并提交（${committed.hash.slice(0, 8)}）。` +
        '请立即调用 task_plan_create 拆解为可执行任务；拆解只入库，不触发执行。',
    }
  }

  private requireProduct(input: { productId?: number; slug?: string }): ProductRecord {
    const product =
      input.productId === undefined
        ? input.slug === undefined
          ? undefined
          : this.store.findProductBySlug(input.slug)
        : this.store.getProduct(input.productId)
    if (product === undefined) {
      throw notFound(
        `需求不存在：${input.productId === undefined ? (input.slug ?? '(未指定)') : String(input.productId)}`,
      )
    }
    return product
  }

  // -------------------------------------------------------------- planning

  /**
   * Store a decomposition result. Validates the graph, allocates task ids,
   * writes the rows, renders the task documents, and wakes the scheduler.
   * @param input - product reference and proposed tasks.
   * @returns the created tasks.
   */
  async plan(
    input: { productId?: number; slug?: string; tasks: PlanTaskInput[] },
    context: { reason?: string } = {},
  ): Promise<PlanResult> {
    const product = this.requireProduct(input)
    if (product.status !== 'confirmed' && product.status !== 'planned') {
      throw new DomainError(
        'not-confirmed',
        `需求 ${product.slug} 尚未确认（当前 ${product.status}），不能拆解`,
        { status: product.status },
      )
    }
    const tasks = input.tasks
    if (tasks.length === 0) throw invalidArgument('拆解结果为空：至少需要一个任务')
    for (const task of tasks) {
      if (task.title.trim().length === 0) throw invalidArgument(`任务 ${task.key} 缺少标题`)
      if (task.acceptance.trim().length === 0) {
        throw invalidArgument(`任务 ${task.key}（${task.title}）缺少验收标准`)
      }
    }
    const graph = validatePlanGraph(
      tasks.map((task) => ({ key: task.key, dependsOn: task.dependsOn })),
    )

    const ids = this.store.reserveTaskIds(tasks.length)
    const idByKey = new Map<string, string>()
    tasks.forEach((task, index) => idByKey.set(task.key, ids[index] as string))

    const usedSlugs = new Set(this.store.listTasks().map((task) => task.slug))
    const prepared: PreparedTask[] = tasks.map((task, index) => {
      const id = ids[index] as string
      // A caller-supplied slug is accepted only when it is already safe.
      const requested =
        task.slug !== undefined && isSlug(task.slug) ? task.slug : slugify(task.title, 'task')
      const slug = uniqueSlug(requested, usedSlugs)
      usedSlugs.add(slug)
      return {
        id,
        title: task.title.trim(),
        slug,
        documentPath: this.paths.toRelative(this.paths.taskDoc(id, slug)),
        acceptance: task.acceptance.trim(),
        verifyCommands: task.verifyCommands ?? [],
        detail: {
          goal: task.goal.trim(),
          scope: task.scope ?? [],
          risks: task.risks ?? '',
          rollback: task.rollback ?? '',
        },
        priority: task.priority ?? 100,
        estimate: task.estimate ?? 'M',
        dependsOn: (graph.get(task.key) ?? []).map((key) => idByKey.get(key) as string),
      }
    })

    const created = this.store.createTasks(product.id, prepared, nowIso(this.now()))
    for (const task of created) {
      writeTextFile(
        this.paths.taskDoc(task.id, task.slug),
        renderTaskDocument(toDocumentInput(task)),
      )
    }
    this.store.appendEvent('plan/created', {
      productId: product.id,
      data: { slug: product.slug, tasks: created.map((task) => task.id) },
    })

    let docsCommit: string | null = null
    let warning: string | null = null
    const committed = await this.git.commit(
      `docs(task): 拆解 ${product.slug} 需求为 ${String(created.length)} 个任务`,
      created.map((task) => task.documentPath),
    )
    if (committed.ok) docsCommit = committed.hash
    else warning = committed.message

    this.hooks.requestScan?.(context.reason ?? 'task-added')
    return {
      productId: product.id,
      slug: product.slug,
      tasks: created,
      docsCommit,
      warning,
      instruction:
        warning === null
          ? `已入库 ${String(created.length)} 个任务（${created.map((task) => task.id).join('、')}），调度器已唤醒。`
          : `任务已入库，但文档提交失败：${warning}。请人工处理后调用 task_progress 或等待下一次扫描。`,
    }
  }

  // ----------------------------------------------------------------- query

  /** Query tasks (read-only). */
  query(
    filter: {
      taskId?: string
      status?: TaskStatus
      includeBlocked?: boolean
      productId?: number
    } = {},
  ): Record<string, unknown> {
    if (filter.taskId !== undefined) {
      const task = this.store.getTask(filter.taskId)
      if (task === undefined)
        throw notFound(`任务不存在：${filter.taskId}`, { taskId: filter.taskId })
      return {
        task: this.describeTask(task),
        attempts: this.store.listAttempts(task.id),
        events: this.store.listEvents(50).filter((event) => event.taskId === task.id),
      }
    }
    if (filter.status !== undefined && !TASK_STATUSES.includes(filter.status)) {
      throw invalidArgument(`未知状态：${filter.status}`)
    }
    const tasks = this.store
      .listTasks({
        ...(filter.status === undefined ? {} : { status: filter.status }),
        ...(filter.productId === undefined ? {} : { productId: filter.productId }),
      })
      .filter((task) => (filter.includeBlocked === false ? task.status !== 'blocked' : true))
    return {
      counts: this.store.countByStatus(),
      tasks: tasks.map((task) => this.describeTask(task)),
      openNotifications: this.store.listNotifications().length,
    }
  }

  /** Render one task for tool/panel consumption. */
  describeTask(task: TaskRecord): Record<string, unknown> {
    return {
      taskId: task.id,
      title: task.title,
      status: task.status,
      statusLabel: STATUS_LABEL[task.status],
      dependsOn: task.dependsOn,
      documentPath: task.documentPath,
      productSlug: task.productSlug,
      priority: task.priority,
      estimate: task.estimate,
      attempt: task.attempt,
      commit: task.commit,
      blockedReason: task.blockedReason,
      executable: task.status === 'pending' && this.dependenciesDone(task),
    }
  }

  private dependenciesDone(task: TaskRecord): boolean {
    return task.dependsOn.every((id) => {
      const dependency = this.store.getTask(id)
      return (
        dependency !== undefined &&
        (dependency.status === 'done' || dependency.status === 'cancelled')
      )
    })
  }

  // -------------------------------------------------------------- progress

  /**
   * Record an execution progress report from a task session.
   *
   * `done` is a claim only: the executor verifies the commit and the acceptance
   * criteria before the task actually reaches `done`.
   * @param input - report payload.
   */
  reportProgress(input: {
    taskId: string
    status: 'running' | 'failed' | 'blocked' | 'done'
    note?: string
    commit?: string
  }): Record<string, unknown> {
    const task = this.store.getTask(input.taskId)
    if (task === undefined) throw notFound(`任务不存在：${input.taskId}`, { taskId: input.taskId })
    const note = input.note ?? ''
    if (input.status === 'done') {
      this.store.appendEvent('task/claim-done', {
        taskId: task.id,
        data: { note, commit: input.commit ?? null },
      })
      return {
        taskId: task.id,
        status: task.status,
        claimed: 'done',
        verified: false,
        documentPath: task.documentPath,
        instruction:
          '完成声明已记录。执行器会校验提交与验收标准后把状态标记为 done；请确保改动已保存在工作区。',
      }
    }
    if (input.status === 'running' && task.status === 'running') {
      this.store.appendEvent('task/note', { taskId: task.id, data: { note } })
      return {
        taskId: task.id,
        status: task.status,
        documentPath: task.documentPath,
        instruction: '进度已记录。',
      }
    }
    const patch =
      input.status === 'failed'
        ? {
            errorKind: 'model' as FailureKind,
            errorMessage: note.length > 0 ? note : '任务自行上报失败',
            finishedAt: nowIso(this.now()),
          }
        : {}
    const updated = this.store.transition(task.id, input.status, patch)
    if (input.status === 'failed') this.blockDownstream(updated.id)
    this.writeTaskDocument(updated)
    return {
      taskId: updated.id,
      status: updated.status,
      documentPath: updated.documentPath,
      instruction: input.status === 'failed' ? '已标记失败，下游任务转为阻塞。' : '状态已更新。',
    }
  }

  // --------------------------------------------------------- interventions

  /** Re-queue a task after a failure, interruption, or manual pause. */
  async retryTask(taskId: string, reason: string): Promise<Record<string, unknown>> {
    const task = this.store.getTask(taskId)
    if (task === undefined) throw notFound(`任务不存在：${taskId}`, { taskId })
    this.store.transition(task.id, 'pending', {
      commit: null,
      blockedReason: null,
      errorKind: null,
      errorMessage: null,
      finishedAt: null,
      runnerSessionId: null,
    })
    this.store.appendEvent('task/retry', { taskId: task.id, data: { reason } })
    const released = this.releaseDownstream(task.id)
    this.store.resolveNotificationsForTask(task.id, nowIso(this.now()))
    const updated = this.requireTask(task.id)
    this.writeTaskDocument(updated)
    await this.commitTaskDocuments([updated, ...released.tasks], `docs(task): 重新排队 ${task.id}`)
    this.hooks.requestScan?.('manual-retry')
    return { taskId: task.id, status: 'pending', released: released.ids, reason }
  }

  /** Skip a task; its downstream tasks are released. */
  async skipTask(taskId: string, reason: string): Promise<Record<string, unknown>> {
    const task = this.store.getTask(taskId)
    if (task === undefined) throw notFound(`任务不存在：${taskId}`, { taskId })
    const updated = this.store.transition(task.id, 'cancelled', {
      errorKind: 'spec',
      errorMessage: `人工跳过：${reason}`,
      finishedAt: nowIso(this.now()),
    })
    this.store.appendEvent('task/skipped', { taskId: task.id, data: { reason } })
    const released = this.releaseDownstream(task.id)
    this.store.resolveNotificationsForTask(task.id, nowIso(this.now()))
    this.writeTaskDocument(updated)
    await this.commitTaskDocuments([updated, ...released.tasks], `docs(task): 跳过 ${task.id}`)
    this.hooks.requestScan?.('manual-skip')
    return { taskId: task.id, status: 'cancelled', released: released.ids, reason }
  }

  /** Cancel every unfinished task. */
  async cancelAll(reason: string): Promise<Record<string, unknown>> {
    const cancelled: string[] = []
    const touched: TaskRecord[] = []
    for (const task of this.store.listTasks()) {
      if (task.status === 'done' || task.status === 'cancelled') continue
      const updated = this.store.transition(task.id, 'cancelled', {
        errorMessage: `整批取消：${reason}`,
        finishedAt: nowIso(this.now()),
      })
      cancelled.push(task.id)
      touched.push(updated)
      this.writeTaskDocument(updated)
    }
    this.store.appendEvent('plan/cancelled', { data: { reason, tasks: cancelled } })
    if (touched.length > 0) {
      await this.commitTaskDocuments(
        touched,
        `docs(task): 取消 ${String(touched.length)} 个未完成任务`,
      )
    }
    return { cancelled, reason }
  }

  /**
   * Commit orchestrator-owned document updates made outside a task run, so the
   * worktree is clean again before the next task's preflight.
   */
  private async commitTaskDocuments(tasks: readonly TaskRecord[], message: string): Promise<void> {
    const paths = [...new Set(tasks.map((task) => task.documentPath))]
    if (paths.length === 0) return
    const outcome = await this.git.commit(message, paths)
    if (!outcome.ok) {
      this.logger.warn(`task-orchestrator: 文档状态提交被跳过（${outcome.message}）`)
    }
  }

  private releaseDownstream(taskId: string): { ids: string[]; tasks: TaskRecord[] } {
    const ids: string[] = []
    const tasks: TaskRecord[] = []
    for (const id of this.store.transitiveDownstream(taskId)) {
      const task = this.store.getTask(id)
      if (task === undefined || task.status !== 'blocked') continue
      const updated = this.store.transition(id, 'pending', { blockedReason: null })
      this.writeTaskDocument(updated)
      ids.push(id)
      tasks.push(updated)
    }
    return { ids, tasks }
  }

  private blockDownstream(taskId: string): string[] {
    const blocked: string[] = []
    for (const id of this.store.transitiveDownstream(taskId)) {
      const task = this.store.getTask(id)
      if (task === undefined || task.status !== 'pending') continue
      const updated = this.store.transition(id, 'blocked', {
        blockedReason: `blocked_by ${taskId}`,
      })
      this.writeTaskDocument(updated)
      blocked.push(id)
    }
    return blocked
  }

  // --------------------------------------------------------- execution API

  /** Mark a task as running under the given executor session. */
  beginTask(taskId: string, sessionId: string): TaskRecord {
    const task = this.store.getTask(taskId)
    if (task === undefined) throw notFound(`任务不存在：${taskId}`, { taskId })
    const attempt = task.attempt + 1
    const updated = this.store.transition(task.id, 'running', {
      attempt,
      runnerSessionId: sessionId,
      startedAt: nowIso(this.now()),
      finishedAt: null,
      errorKind: null,
      errorMessage: null,
    })
    this.store.openAttempt(task.id, attempt, sessionId, nowIso(this.now()))
    this.writeTaskDocument(updated)
    return updated
  }

  /**
   * Finish a task successfully: update its document and the feature overview,
   * commit everything as this task's single commit, then mark it done.
   * @param taskId - task id.
   * @param commitMessage - commit subject (already formatted).
   * @returns the updated task and the commit hash.
   */
  async finishTask(
    taskId: string,
    commitMessage: string,
    options: { amend?: boolean } = {},
  ): Promise<{ ok: true; task: TaskRecord; commit: string } | { ok: false; message: string }> {
    const task = this.store.getTask(taskId)
    if (task === undefined) throw notFound(`任务不存在：${taskId}`, { taskId })
    if (task.status !== 'running') {
      throw new DomainError('conflict', `任务 ${taskId} 当前为 ${task.status}，无法标记完成`)
    }
    const finishedAt = nowIso(this.now())
    const documentPath = this.paths.taskDoc(task.id, task.slug)
    const featuresPath = this.paths.systemFeaturesPath
    const featuresBefore = readTextIfExists(featuresPath)

    // Render the completed document and settle the feature overview first, so
    // both land in the same single task commit.
    writeTextFile(
      documentPath,
      renderTaskDocument(
        toDocumentInput({ ...task, status: 'done', finishedAt, blockedReason: null }),
      ),
    )
    this.advanceFeatureStates(task)

    const outcome =
      options.amend === true
        ? await this.git.amendCommit(commitMessage)
        : await this.git.commit(commitMessage, [])
    if (!outcome.ok) {
      // Nothing was recorded as done: restore both documents to their pre-run state.
      writeTextFile(documentPath, renderTaskDocument(toDocumentInput(task)))
      if (featuresBefore === undefined) rmSync(featuresPath, { force: true })
      else writeTextFile(featuresPath, featuresBefore)
      return { ok: false, message: outcome.message }
    }

    const updated = this.store.transition(task.id, 'done', {
      commit: outcome.hash,
      finishedAt,
      blockedReason: null,
      runnerSessionId: null,
    })
    this.store.closeAttempt(task.id, task.attempt, 'done', { commit: outcome.hash }, finishedAt)
    this.store.resolveNotificationsForTask(task.id, finishedAt)
    this.store.appendEvent('task/finished', { taskId: task.id, data: { commit: outcome.hash } })
    this.hooks.requestScan?.('task-complete')
    return { ok: true, task: updated, commit: outcome.hash }
  }

  /** Advance the feature overview entries implemented by a finished task. */
  advanceFeatureStates(task: TaskRecord): number {
    const summary = readFeatureSummary(readTextIfExists(this.paths.systemFeaturesPath) ?? null)
    const related =
      entriesFor(summary, { taskId: task.id }).length > 0
        ? entriesFor(summary, { taskId: task.id })
        : entriesFor(summary, { slug: task.productSlug })
    if (related.length === 0) return 0
    const deltas: FeatureDelta[] = related.map(({ domain, entry }) => ({
      op: 'update' as const,
      domain,
      name: entry.name,
      state: '已实现' as const,
      taskIds: entry.taskIds.includes(task.id) ? entry.taskIds : [...entry.taskIds, task.id],
    }))
    const isLastTask = this.store
      .listTasks({ productId: task.productId })
      .every(
        (candidate) =>
          candidate.id === task.id ||
          candidate.status === 'done' ||
          candidate.status === 'cancelled',
      )
    /** Only the last task of a requirement settles the whole domain entry. */
    const filtered = isLastTask
      ? deltas
      : deltas.map((delta) => ({ ...delta, state: '实现中' as const }))
    this.applyFeatures(task.productSlug, filtered, { note: `任务 ${task.id} 完成，功能状态推进` })
    return filtered.length
  }

  /** Record a failed (or retried) attempt. */
  async failTask(
    taskId: string,
    failure: { kind: FailureKind; message: string; retryable: boolean },
  ): Promise<{ task: TaskRecord; retrying: boolean; blocked: string[] }> {
    const task = this.store.getTask(taskId)
    if (task === undefined) throw notFound(`任务不存在：${taskId}`, { taskId })
    this.store.closeAttempt(
      task.id,
      task.attempt,
      'failed',
      { errorKind: failure.kind, errorMessage: failure.message },
      nowIso(this.now()),
    )
    const canRetry = failure.retryable && task.attempt <= this.options.maxRetries
    if (canRetry) {
      const updated = this.store.transition(task.id, 'pending', {
        errorKind: failure.kind,
        errorMessage: failure.message,
        runnerSessionId: null,
        finishedAt: null,
      })
      this.writeTaskDocument(updated)
      const delay =
        this.options.retryBackoffMs[
          Math.min(task.attempt - 1, this.options.retryBackoffMs.length - 1)
        ] ?? 30_000
      this.store.appendEvent('task/retry-scheduled', {
        taskId: task.id,
        data: { attempt: updated.attempt, delayMs: delay, kind: failure.kind },
      })
      await this.commitTaskDocuments([updated], `docs(task): 记录 ${task.id} 失败待重试`)
      this.logger.warn(
        `task-orchestrator: 任务 ${task.id} 失败（${failure.kind}），${String(delay)}ms 后重试`,
      )
      this.hooks.requestScan?.('retry-backoff', delay)
      return { task: updated, retrying: true, blocked: [] }
    }
    const patch = {
      errorKind: failure.kind,
      errorMessage: failure.message,
      runnerSessionId: null,
      finishedAt: nowIso(this.now()),
    }
    const failed =
      task.status === 'running' || task.status === 'pending'
        ? this.store.transition(task.id, 'failed', patch)
        : this.store.patchTask(task.id, patch)
    this.writeTaskDocument(failed)
    await this.commitTaskDocuments([failed], `docs(task): 记录 ${task.id} 执行失败`)
    const blocked = this.blockDownstream(failed.id)
    this.store.addNotification({
      taskId: failed.id,
      kind: 'failed',
      title: `${failed.id} ${failed.title} 执行失败`,
      message: `[${failure.kind}] ${failure.message}${blocked.length > 0 ? `；下游阻塞：${blocked.join('、')}` : ''}`,
      now: nowIso(this.now()),
    })
    this.hooks.onNotification?.(failed.id)
    this.logger.error(`task-orchestrator: 任务 ${failed.id} 失败并停止重试：${failure.message}`)
    return { task: failed, blocked, retrying: false }
  }

  /** Reconcile tasks left `running` by a previous process. */
  async recoverInterrupted(): Promise<TaskRecord[]> {
    const recovered: TaskRecord[] = []
    for (const task of this.store.runningTasks()) {
      this.store.closeAttempt(
        task.id,
        task.attempt,
        'failed',
        { errorKind: 'interrupted', errorMessage: '进程中断，执行会话已不存在' },
        nowIso(this.now()),
      )
      const result = await this.failTask(task.id, {
        kind: 'interrupted',
        message: '上一次执行被中断（进程退出或重启）',
        retryable: true,
      })
      recovered.push(result.task)
    }
    return recovered
  }

  /** Re-render one task document from its stored row. */
  writeTaskDocument(task: TaskRecord): void {
    const path = this.paths.taskDoc(task.id, task.slug)
    writeTextFile(path, renderTaskDocument(toDocumentInput(task)))
  }

  private requireTask(taskId: string): TaskRecord {
    const task = this.store.getTask(taskId)
    if (task === undefined) throw notFound(`任务不存在：${taskId}`, { taskId })
    return task
  }

  /** Read a document body for debugging/panel display. */
  readDocument(path: string): string {
    return readFileSync(path, 'utf8')
  }
}

function toDocumentInput(task: TaskRecord): Parameters<typeof renderTaskDocument>[0] {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    estimate: task.estimate,
    priority: task.priority,
    acceptance: task.acceptance,
    verifyCommands: task.verifyCommands,
    detail: task.detail,
    dependsOn: task.dependsOn,
    productSlug: task.productSlug,
    productDocumentPath: `docs/products/${task.productSlug}.md`,
    createdAt: task.createdAt,
    commit: task.commit,
    attempt: task.attempt,
    blockedReason: task.blockedReason,
  }
}

/** Patch the status line of a stored requirement document. */
export function patchRequirementStatus(body: string, status: string): string {
  if (!body.includes('- 状态：')) {
    return body.replace(/- 需求 slug：.*\n/u, (line) => `${line}- 状态：${status}\n`)
  }
  return body.replace(/^- 状态：.*$/mu, `- 状态：${status}`)
}

/** Append a numeric suffix until the slug is unused. */
function uniqueSlug(base: string, used: ReadonlySet<string>): string {
  if (!used.has(base)) return base
  let index = 2
  while (used.has(`${base}-${String(index)}`)) index += 1
  return `${base}-${String(index)}`
}
