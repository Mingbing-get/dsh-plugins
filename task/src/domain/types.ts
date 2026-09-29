/**
 * Domain vocabulary shared by the store, the tools, the scheduler, and the
 * document renderers. Pure types only: nothing here touches SQLite, git, or
 * cordis, so both the host plugin and the tests can consume it directly.
 */

/** Lifecycle of one product requirement. */
export type ProductStatus = 'draft' | 'pending_confirmation' | 'confirmed' | 'planned' | 'archived'

/** Lifecycle of one executable task (see the state machine in `status.ts`). */
export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'blocked' | 'cancelled'

/** Landing state of one entry in the system feature overview. */
export type FeatureState = '待实现' | '实现中' | '已实现' | '已下线'

/** Coarse effort bucket declared by the planner. */
export type Estimate = 'S' | 'M' | 'L'

/** One change the requirement brings to the system feature overview. */
export interface FeatureDelta {
  op: 'add' | 'update' | 'remove'
  /** Feature domain the entry belongs to, creating the domain when absent. */
  domain: string
  /** Stable feature-point name inside that domain. */
  name: string
  /** Current system behaviour; required for `add` and `update`, ignored for `remove`. */
  behavior?: string
  /** Landing state; defaults to `待实现` on `add`. */
  state?: FeatureState
  /** Task ids implementing this entry; defaults to empty. */
  taskIds?: string[]
}

/** A structured answer the requirement analyst still needs from the human. */
export interface OpenQuestion {
  id: string
  question: string
  detail?: string
  options?: { label: string; description?: string }[]
}

/** One product requirement row. */
export interface ProductRecord {
  id: number
  slug: string
  title: string
  documentPath: string
  status: ProductStatus
  featureDeltas: FeatureDelta[]
  /** Full Markdown body captured when the document was generated. */
  documentBody: string
  commit: string | null
  createdAt: string
  confirmedAt: string | null
}

/** Free-form sections rendered into the task document. */
export interface TaskDetail {
  goal: string
  scope: string[]
  risks: string
  rollback: string
}

/** One executable task row, with its dependency list inlined. */
export interface TaskRecord {
  id: string
  seq: number
  productId: number
  productSlug: string
  title: string
  slug: string
  documentPath: string
  status: TaskStatus
  priority: number
  estimate: Estimate
  acceptance: string
  verifyCommands: string[]
  detail: TaskDetail
  blockedReason: string | null
  commit: string | null
  attempt: number
  runnerSessionId: string | null
  errorKind: string | null
  errorMessage: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  dependsOn: string[]
}

/** One task as proposed by the planner, before ids are allocated. */
export interface PlanTaskInput {
  /** Stable planner-local key used by `dependsOn` inside the same plan. */
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

/** One recorded execution attempt of a task. */
export interface AttemptRecord {
  id: number
  taskId: string
  attempt: number
  sessionId: string | null
  status: 'running' | 'done' | 'failed'
  errorKind: string | null
  errorMessage: string | null
  commit: string | null
  startedAt: string
  finishedAt: string | null
}

/** One append-only audit event. */
export interface TaskEventRecord {
  id: number
  at: string
  kind: string
  taskId: string | null
  productId: number | null
  data: Record<string, unknown>
}

/** Reason a notification needs human attention. */
export type NotificationKind = 'failed' | 'blocked' | 'scheduler' | 'infrastructure'

/** One item shown by the floating intervention panel. */
export interface NotificationRecord {
  id: number
  taskId: string | null
  kind: NotificationKind
  title: string
  message: string
  createdAt: string
  readAt: string | null
  resolvedAt: string | null
}

/** Why a task attempt ended in failure. */
export type FailureKind =
  'model' | 'tool' | 'verification' | 'timeout' | 'git' | 'spec' | 'interrupted'

/** Structured result of one finished task run. */
export type TaskRunOutcome =
  | { kind: 'done'; commit: string }
  | { kind: 'failed'; failure: FailureKind; message: string; retryable: boolean }
  | { kind: 'interrupted'; message: string }

/** Structured result of one requirement draft round. */
export interface RequirementDraftResult {
  slug: string
  productId: number | null
  documentPath: string
  status: ProductStatus
  closed: boolean
  round: number
  answers: { id: string; selected: string[]; custom?: string }[]
}
