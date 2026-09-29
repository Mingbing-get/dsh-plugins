/**
 * SQLite repository. All writes happen inside transactions, status changes use
 * conditional updates (`WHERE status = ?`) as an optimistic lock, and every
 * state change also appends an audit event.
 */

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { assertTransition } from '../domain/status.ts'
import { nowIso } from '../domain/text.ts'
import { DomainError, notFound } from '../domain/errors.ts'
import type {
  AttemptRecord,
  Estimate,
  FeatureDelta,
  NotificationKind,
  NotificationRecord,
  ProductRecord,
  ProductStatus,
  TaskDetail,
  TaskEventRecord,
  TaskRecord,
  TaskStatus,
} from '../domain/types.ts'
import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from './schema.ts'

/** A parameter accepted by the sqlite driver. */
type Param = string | number | null

/** One raw row. */
type Row = Record<string, unknown>

/** A task ready to be inserted (ids already reserved). */
export interface PreparedTask {
  id: string
  title: string
  slug: string
  documentPath: string
  acceptance: string
  verifyCommands: string[]
  detail: TaskDetail
  priority: number
  estimate: Estimate
  dependsOn: string[]
}

/** Fields a status transition may patch. */
export interface TaskPatch {
  blockedReason?: string | null
  commit?: string | null
  attempt?: number
  runnerSessionId?: string | null
  errorKind?: string | null
  errorMessage?: string | null
  startedAt?: string | null
  finishedAt?: string | null
}

/** Options accepted when opening the store. */
export interface OpenStoreOptions {
  databasePath: string
}

/** Filter for {@link TaskStore.listTasks}. */
export interface TaskFilter {
  status?: TaskStatus | TaskStatus[]
  productId?: number
}

function parseJson<T>(text: unknown, fallback: T): T {
  if (typeof text !== 'string' || text.length === 0) return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

function text(row: Row, key: string): string {
  const value = row[key]
  return typeof value === 'string' ? value : String(value ?? '')
}

function nullableText(row: Row, key: string): string | null {
  const value = row[key]
  return typeof value === 'string' ? value : null
}

function integer(row: Row, key: string): number {
  const value = row[key]
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  return Number(value ?? 0)
}

function safeJson(value: unknown): string {
  return JSON.stringify(value ?? {})
}

/** Authoritative store for products, tasks, dependencies, and interventions. */
export class TaskStore {
  private readonly db: DatabaseSync

  private constructor(db: DatabaseSync) {
    this.db = db
  }

  /**
   * Open (and create when absent) the database.
   * @param options - absolute database path.
   * @returns the opened store.
   */
  static open(options: OpenStoreOptions): TaskStore {
    mkdirSync(dirname(options.databasePath), { recursive: true })
    const db = new DatabaseSync(options.databasePath)
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = FULL')
    db.exec('PRAGMA busy_timeout = 5000')
    for (const statement of SCHEMA_STATEMENTS) db.exec(statement)
    const store = new TaskStore(db)
    store.setSetting('schema_version', String(SCHEMA_VERSION))
    return store
  }

  /** Open an in-memory store (tests). */
  static memory(): TaskStore {
    const db = new DatabaseSync(':memory:')
    for (const statement of SCHEMA_STATEMENTS) db.exec(statement)
    return new TaskStore(db)
  }

  /** Close the underlying database. */
  close(): void {
    this.db.close()
  }

  private get<T extends Row>(sql: string, ...params: Param[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined
  }

  private all<T extends Row>(sql: string, ...params: Param[]): T[] {
    return this.db.prepare(sql).all(...params) as T[]
  }

  private run(sql: string, ...params: Param[]): { changes: number; lastInsertRowid: number } {
    const result = this.db.prepare(sql).run(...params)
    return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) }
  }

  /** Run `body` inside a transaction, rolling back on throw. */
  transaction<T>(body: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const value = body()
      this.db.exec('COMMIT')
      return value
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // The transaction may already be unwound; the original error is authoritative.
      }
      throw error
    }
  }

  // ---------------------------------------------------------------- settings

  /** Read one setting. */
  getSetting(key: string): string | undefined {
    const row = this.get<Row>('SELECT value FROM setting WHERE key = ?', key)
    return row === undefined ? undefined : text(row, 'value')
  }

  /** Write one setting. */
  setSetting(key: string, value: string): void {
    this.run(
      'INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value,
    )
  }

  // ---------------------------------------------------------------- products

  /** Insert a product requirement. */
  createProduct(input: {
    slug: string
    title: string
    documentPath: string
    status: ProductStatus
    featureDeltas: FeatureDelta[]
    documentBody?: string
    now?: string
  }): ProductRecord {
    const at = input.now ?? nowIso()
    const existing = this.findProductBySlug(input.slug)
    if (existing !== undefined) {
      this.run(
        `UPDATE product SET title = ?, document_path = ?, status = ?, feature_deltas = ?, document_body = ?
         WHERE id = ?`,
        input.title,
        input.documentPath,
        input.status,
        safeJson(input.featureDeltas),
        input.documentBody ?? existing.documentBody,
        existing.id,
      )
      return this.requireProduct(existing.id)
    }
    const result = this.run(
      `INSERT INTO product (slug, title, document_path, status, feature_deltas, document_body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      input.slug,
      input.title,
      input.documentPath,
      input.status,
      safeJson(input.featureDeltas),
      input.documentBody ?? '',
      at,
    )
    this.appendEvent('product/created', {
      productId: result.lastInsertRowid,
      data: { slug: input.slug },
    })
    return this.requireProduct(result.lastInsertRowid)
  }

  /** Look up a product by primary key. */
  getProduct(id: number): ProductRecord | undefined {
    const row = this.get<Row>('SELECT * FROM product WHERE id = ?', id)
    return row === undefined ? undefined : mapProduct(row)
  }

  /** Look up a product by slug. */
  findProductBySlug(slug: string): ProductRecord | undefined {
    const row = this.get<Row>('SELECT * FROM product WHERE slug = ?', slug)
    return row === undefined ? undefined : mapProduct(row)
  }

  /** All products, newest first. */
  listProducts(): ProductRecord[] {
    return this.all<Row>('SELECT * FROM product ORDER BY id DESC').map(mapProduct)
  }

  private requireProduct(id: number): ProductRecord {
    const product = this.getProduct(id)
    if (product === undefined) throw notFound(`需求不存在：${String(id)}`)
    return product
  }

  /** Move a product to another status. */
  setProductStatus(
    id: number,
    status: ProductStatus,
    patch: { commit?: string | null; confirmedAt?: string | null; documentBody?: string } = {},
  ): ProductRecord {
    const current = this.requireProduct(id)
    this.run(
      'UPDATE product SET status = ?, commit_hash = ?, confirmed_at = ?, document_body = ? WHERE id = ?',
      status,
      patch.commit === undefined ? current.commit : patch.commit,
      patch.confirmedAt === undefined ? current.confirmedAt : patch.confirmedAt,
      patch.documentBody === undefined ? current.documentBody : patch.documentBody,
      id,
    )
    return this.requireProduct(id)
  }

  /** Replace the recorded feature deltas of a product. */
  setProductDeltas(id: number, deltas: FeatureDelta[]): void {
    this.requireProduct(id)
    this.run('UPDATE product SET feature_deltas = ? WHERE id = ?', safeJson(deltas), id)
  }

  // ------------------------------------------------------------------- tasks

  /**
   * Reserve `count` fresh task ids. Ids are never reused, so a reserved id is
   * consumed even if the caller aborts afterwards.
   */
  reserveTaskIds(count: number): string[] {
    if (!Number.isInteger(count) || count <= 0) {
      throw new DomainError('invalid-argument', `任务数量必须是正整数，收到 ${String(count)}`)
    }
    return this.transaction(() => {
      const next = Number(this.getSetting('task_seq') ?? '0') + 1
      this.setSetting('task_seq', String(next + count - 1))
      return Array.from({ length: count }, (_, index) => `T${String(next + index)}`)
    })
  }

  /** Insert a batch of tasks and their dependencies in one transaction. */
  createTasks(productId: number, tasks: readonly PreparedTask[], now?: string): TaskRecord[] {
    const at = now ?? nowIso()
    this.requireProduct(productId)
    return this.transaction(() => {
      for (const task of tasks) {
        this.run(
          `INSERT INTO task (
             id, seq, product_id, title, slug, document_path, status, priority, estimate,
             acceptance, verify_commands, detail, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
          task.id,
          Number(task.id.replace(/^T/u, '')),
          productId,
          task.title,
          task.slug,
          task.documentPath,
          task.priority,
          task.estimate,
          task.acceptance,
          safeJson(task.verifyCommands),
          safeJson(task.detail),
          at,
        )
      }
      for (const task of tasks) {
        for (const dependency of task.dependsOn) {
          this.run(
            'INSERT OR IGNORE INTO task_dependency (task_id, depends_on) VALUES (?, ?)',
            task.id,
            dependency,
          )
        }
      }
      for (const task of tasks) {
        this.appendEvent('task/created', {
          taskId: task.id,
          productId,
          data: { dependsOn: task.dependsOn },
        })
      }
      this.run('UPDATE product SET status = ? WHERE id = ?', 'planned', productId)
      return tasks.map((task) => this.requireTask(task.id))
    })
  }

  /** Look up a task by id. */
  getTask(id: string): TaskRecord | undefined {
    const row = this.get<Row>('SELECT * FROM task WHERE id = ?', id)
    return row === undefined ? undefined : this.decorate(row)
  }

  private requireTask(id: string): TaskRecord {
    const task = this.getTask(id)
    if (task === undefined) throw notFound(`任务不存在：${id}`, { taskId: id })
    return task
  }

  private decorate(row: Row): TaskRecord {
    const id = text(row, 'id')
    const product = this.getProduct(integer(row, 'product_id'))
    return {
      id,
      seq: integer(row, 'seq'),
      productId: integer(row, 'product_id'),
      productSlug: product?.slug ?? '',
      title: text(row, 'title'),
      slug: text(row, 'slug'),
      documentPath: text(row, 'document_path'),
      status: text(row, 'status') as TaskStatus,
      priority: integer(row, 'priority'),
      estimate: text(row, 'estimate') as Estimate,
      acceptance: text(row, 'acceptance'),
      verifyCommands: parseJson<string[]>(row['verify_commands'], []),
      detail: parseJson<TaskDetail>(row['detail'], {
        goal: '',
        scope: [],
        risks: '',
        rollback: '',
      }),
      blockedReason: nullableText(row, 'blocked_reason'),
      commit: nullableText(row, 'commit_hash'),
      attempt: integer(row, 'attempt'),
      runnerSessionId: nullableText(row, 'runner_session_id'),
      errorKind: nullableText(row, 'error_kind'),
      errorMessage: nullableText(row, 'error_message'),
      createdAt: text(row, 'created_at'),
      startedAt: nullableText(row, 'started_at'),
      finishedAt: nullableText(row, 'finished_at'),
      dependsOn: this.dependenciesOf(id),
    }
  }

  /** Direct dependencies of one task. */
  dependenciesOf(taskId: string): string[] {
    return this.all<Row>(
      'SELECT depends_on FROM task_dependency WHERE task_id = ? ORDER BY depends_on',
      taskId,
    ).map((row) => text(row, 'depends_on'))
  }

  /** Whole dependency graph, keyed by task id. */
  dependencyGraph(): Map<string, string[]> {
    const graph = new Map<string, string[]>()
    for (const row of this.all<Row>('SELECT id FROM task ORDER BY seq')) {
      graph.set(text(row, 'id'), [])
    }
    for (const row of this.all<Row>('SELECT task_id, depends_on FROM task_dependency')) {
      const list = graph.get(text(row, 'task_id'))
      if (list !== undefined) list.push(text(row, 'depends_on'))
    }
    return graph
  }

  /** Tasks that depend directly on `taskId`. */
  downstreamOf(taskId: string): string[] {
    return this.all<Row>(
      'SELECT task_id FROM task_dependency WHERE depends_on = ? ORDER BY task_id',
      taskId,
    ).map((row) => text(row, 'task_id'))
  }

  /**
   * Transitive downstream tasks, breadth-first.
   * @param taskId - root task.
   * @returns every task reachable through dependency edges, excluding the root.
   */
  transitiveDownstream(taskId: string): string[] {
    const seen = new Set<string>()
    const queue = [...this.downstreamOf(taskId)]
    while (queue.length > 0) {
      const next = queue.shift() as string
      if (seen.has(next)) continue
      seen.add(next)
      queue.push(...this.downstreamOf(next))
    }
    return [...seen]
  }

  /** List tasks, optionally filtered. */
  listTasks(filter: TaskFilter = {}): TaskRecord[] {
    const rows = this.all<Row>('SELECT * FROM task ORDER BY priority ASC, seq ASC')
    const statuses =
      filter.status === undefined
        ? undefined
        : Array.isArray(filter.status)
          ? filter.status
          : [filter.status]
    return rows
      .map((row) => this.decorate(row))
      .filter((task) => statuses === undefined || statuses.includes(task.status))
      .filter((task) => filter.productId === undefined || task.productId === filter.productId)
  }

  /** Count tasks per status. */
  countByStatus(): Record<TaskStatus, number> {
    const counts: Record<TaskStatus, number> = {
      pending: 0,
      running: 0,
      blocked: 0,
      done: 0,
      failed: 0,
      cancelled: 0,
    }
    for (const row of this.all<Row>('SELECT status, COUNT(*) AS total FROM task GROUP BY status')) {
      counts[text(row, 'status') as TaskStatus] = integer(row, 'total')
    }
    return counts
  }

  /**
   * Tasks that may run now: `pending` with every dependency satisfied
   * (`done`, or `cancelled` when a human explicitly skipped the upstream).
   */
  executableTasks(): TaskRecord[] {
    const rows = this.all<Row>(
      `SELECT t.* FROM task t
       WHERE t.status = 'pending'
         AND NOT EXISTS (
           SELECT 1 FROM task_dependency d
           JOIN task x ON x.id = d.depends_on
           WHERE d.task_id = t.id AND x.status NOT IN ('done', 'cancelled')
         )
       ORDER BY t.priority ASC, t.seq ASC`,
    )
    return rows.map((row) => this.decorate(row))
  }

  /** Tasks currently marked running. */
  runningTasks(): TaskRecord[] {
    return this.all<Row>("SELECT * FROM task WHERE status = 'running' ORDER BY seq").map((row) =>
      this.decorate(row),
    )
  }

  /**
   * Apply a status transition with an optimistic lock.
   * @param id - task id.
   * @param to - requested status.
   * @param patch - additional columns to write.
   * @throws DomainError when the task is missing or the row changed underneath.
   */
  transition(id: string, to: TaskStatus, patch: TaskPatch = {}): TaskRecord {
    return this.transaction(() => {
      const task = this.requireTask(id)
      assertTransition(task.status, to, `任务 ${id}`)
      const changes = this.run(
        `UPDATE task SET status = ?, blocked_reason = ?, commit_hash = ?, attempt = ?,
           runner_session_id = ?, error_kind = ?, error_message = ?, started_at = ?, finished_at = ?
         WHERE id = ? AND status = ?`,
        to,
        pick(patch.blockedReason, task.blockedReason),
        pick(patch.commit, task.commit),
        pick(patch.attempt, task.attempt),
        pick(patch.runnerSessionId, task.runnerSessionId),
        pick(patch.errorKind, task.errorKind),
        pick(patch.errorMessage, task.errorMessage),
        pick(patch.startedAt, task.startedAt),
        pick(patch.finishedAt, task.finishedAt),
        id,
        task.status,
      )
      if (changes.changes === 0) {
        throw new DomainError('conflict', `任务 ${id} 状态已被其他进程修改，请重新读取`, {
          taskId: id,
        })
      }
      this.appendEvent(`task/${to}`, {
        taskId: id,
        productId: task.productId,
        data: { from: task.status },
      })
      return this.requireTask(id)
    })
  }

  /**
   * Update bookkeeping columns without changing the status.
   * @param id - task id.
   * @param patch - columns to write.
   * @returns the refreshed task.
   */
  patchTask(id: string, patch: TaskPatch): TaskRecord {
    const task = this.requireTask(id)
    this.run(
      `UPDATE task SET blocked_reason = ?, commit_hash = ?, attempt = ?, runner_session_id = ?,
         error_kind = ?, error_message = ?, started_at = ?, finished_at = ? WHERE id = ?`,
      pick(patch.blockedReason, task.blockedReason),
      pick(patch.commit, task.commit),
      pick(patch.attempt, task.attempt),
      pick(patch.runnerSessionId, task.runnerSessionId),
      pick(patch.errorKind, task.errorKind),
      pick(patch.errorMessage, task.errorMessage),
      pick(patch.startedAt, task.startedAt),
      pick(patch.finishedAt, task.finishedAt),
      id,
    )
    return this.requireTask(id)
  }

  /** Rewrite the rendered document path of a task. */
  setTaskDocumentPath(id: string, documentPath: string): void {
    this.requireTask(id)
    this.run('UPDATE task SET document_path = ? WHERE id = ?', documentPath, id)
  }

  // ---------------------------------------------------------------- attempts

  /** Open one attempt row. */
  openAttempt(
    taskId: string,
    attempt: number,
    sessionId: string | null,
    now?: string,
  ): AttemptRecord {
    const at = now ?? nowIso()
    this.run(
      `INSERT INTO task_attempt (task_id, attempt, session_id, status, started_at)
       VALUES (?, ?, ?, 'running', ?)`,
      taskId,
      attempt,
      sessionId,
      at,
    )
    const row = this.get<Row>(
      'SELECT * FROM task_attempt WHERE task_id = ? AND attempt = ?',
      taskId,
      attempt,
    )
    if (row === undefined) throw notFound(`执行记录写入失败：${taskId}#${String(attempt)}`)
    return mapAttempt(row)
  }

  /** Close the open attempt of a task. */
  closeAttempt(
    taskId: string,
    attempt: number,
    status: 'done' | 'failed',
    patch: { errorKind?: string | null; errorMessage?: string | null; commit?: string | null } = {},
    now?: string,
  ): void {
    this.run(
      `UPDATE task_attempt SET status = ?, error_kind = ?, error_message = ?, commit_hash = ?, finished_at = ?
       WHERE task_id = ? AND attempt = ?`,
      status,
      patch.errorKind ?? null,
      patch.errorMessage ?? null,
      patch.commit ?? null,
      now ?? nowIso(),
      taskId,
      attempt,
    )
  }

  /** All attempts of a task, oldest first. */
  listAttempts(taskId: string): AttemptRecord[] {
    return this.all<Row>(
      'SELECT * FROM task_attempt WHERE task_id = ? ORDER BY attempt ASC',
      taskId,
    ).map(mapAttempt)
  }

  // ------------------------------------------------------------------ events

  /** Append one audit event. */
  appendEvent(
    kind: string,
    input: {
      taskId?: string | undefined
      productId?: number | undefined
      data?: Record<string, unknown> | undefined
      now?: string | undefined
    } = {},
  ): void {
    this.run(
      'INSERT INTO task_event (at, kind, task_id, product_id, data) VALUES (?, ?, ?, ?, ?)',
      input.now ?? nowIso(),
      kind,
      input.taskId ?? null,
      input.productId ?? null,
      safeJson(input.data),
    )
  }

  /** Most recent events, newest first. */
  listEvents(limit = 100): TaskEventRecord[] {
    return this.all<Row>('SELECT * FROM task_event ORDER BY id DESC LIMIT ?', limit).map((row) => ({
      id: integer(row, 'id'),
      at: text(row, 'at'),
      kind: text(row, 'kind'),
      taskId: nullableText(row, 'task_id'),
      productId:
        row['product_id'] === null || row['product_id'] === undefined
          ? null
          : integer(row, 'product_id'),
      data: parseJson<Record<string, unknown>>(row['data'], {}),
    }))
  }

  // ----------------------------------------------------------- notifications

  /** Add or refresh the open notification of one task. */
  addNotification(input: {
    taskId?: string | null
    kind: NotificationKind
    title: string
    message: string
    now?: string
  }): NotificationRecord {
    const at = input.now ?? nowIso()
    const taskId = input.taskId ?? null
    if (taskId !== null) {
      const open = this.all<Row>(
        'SELECT id FROM notification WHERE task_id = ? AND kind = ? AND resolved_at IS NULL',
        taskId,
        input.kind,
      )
      if (open.length > 0) {
        this.run(
          'UPDATE notification SET title = ?, message = ?, created_at = ?, read_at = NULL WHERE id = ?',
          input.title,
          input.message,
          at,
          integer(open[0] as Row, 'id'),
        )
        return this.requireNotification(integer(open[0] as Row, 'id'))
      }
    }
    const result = this.run(
      'INSERT INTO notification (task_id, kind, title, message, created_at) VALUES (?, ?, ?, ?, ?)',
      taskId,
      input.kind,
      input.title,
      input.message,
      at,
    )
    this.appendEvent('notification/raised', {
      taskId: taskId ?? undefined,
      data: { kind: input.kind },
      now: at,
    })
    return this.requireNotification(result.lastInsertRowid)
  }

  private requireNotification(id: number): NotificationRecord {
    const row = this.get<Row>('SELECT * FROM notification WHERE id = ?', id)
    if (row === undefined) throw notFound(`通知不存在：${String(id)}`)
    return mapNotification(row)
  }

  /** List notifications, newest first. */
  listNotifications(options: { includeResolved?: boolean } = {}): NotificationRecord[] {
    const rows =
      options.includeResolved === true
        ? this.all<Row>('SELECT * FROM notification ORDER BY id DESC')
        : this.all<Row>('SELECT * FROM notification WHERE resolved_at IS NULL ORDER BY id DESC')
    return rows.map(mapNotification)
  }

  /** Number of unread open notifications. */
  unreadCount(): number {
    const row = this.get<Row>(
      'SELECT COUNT(*) AS total FROM notification WHERE resolved_at IS NULL AND read_at IS NULL',
    )
    return row === undefined ? 0 : integer(row, 'total')
  }

  /** Mark one notification read. */
  markNotificationRead(id: number, now?: string): void {
    this.run(
      'UPDATE notification SET read_at = ? WHERE id = ? AND read_at IS NULL',
      now ?? nowIso(),
      id,
    )
  }

  /** Resolve one notification. */
  resolveNotification(id: number, now?: string): void {
    this.run('UPDATE notification SET resolved_at = ? WHERE id = ?', now ?? nowIso(), id)
  }

  /** Resolve every open notification of a task. */
  resolveNotificationsForTask(taskId: string, now?: string): void {
    this.run(
      'UPDATE notification SET resolved_at = ? WHERE task_id = ? AND resolved_at IS NULL',
      now ?? nowIso(),
      taskId,
    )
  }

  // -------------------------------------------------------------------- lock

  /**
   * Acquire the single-scheduler lock for this repository.
   * @param name - lock name.
   * @param owner - process/instance identity.
   * @param ttlMs - lease duration; a stale lease is taken over.
   * @returns whether the caller now owns the lock.
   */
  acquireLock(name: string, owner: string, ttlMs: number, now: number = Date.now()): boolean {
    return this.transaction(() => {
      const row = this.get<Row>('SELECT owner, expires_at FROM scheduler_lock WHERE name = ?', name)
      if (row !== undefined && text(row, 'owner') !== owner && integer(row, 'expires_at') > now) {
        return false
      }
      this.run(
        `INSERT INTO scheduler_lock (name, owner, expires_at) VALUES (?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at`,
        name,
        owner,
        now + ttlMs,
      )
      return true
    })
  }

  /** Release the scheduler lock when this owner still holds it. */
  releaseLock(name: string, owner: string): void {
    this.run('DELETE FROM scheduler_lock WHERE name = ? AND owner = ?', name, owner)
  }
}

function pick<T>(patch: T | undefined, current: T): T {
  return patch === undefined ? current : patch
}

function mapProduct(row: Row): ProductRecord {
  return {
    id: integer(row, 'id'),
    slug: text(row, 'slug'),
    title: text(row, 'title'),
    documentPath: text(row, 'document_path'),
    status: text(row, 'status') as ProductStatus,
    featureDeltas: parseJson<FeatureDelta[]>(row['feature_deltas'], []),
    documentBody: text(row, 'document_body'),
    commit: nullableText(row, 'commit_hash'),
    createdAt: text(row, 'created_at'),
    confirmedAt: nullableText(row, 'confirmed_at'),
  }
}

function mapAttempt(row: Row): AttemptRecord {
  return {
    id: integer(row, 'id'),
    taskId: text(row, 'task_id'),
    attempt: integer(row, 'attempt'),
    sessionId: nullableText(row, 'session_id'),
    status: text(row, 'status') as AttemptRecord['status'],
    errorKind: nullableText(row, 'error_kind'),
    errorMessage: nullableText(row, 'error_message'),
    commit: nullableText(row, 'commit_hash'),
    startedAt: text(row, 'started_at'),
    finishedAt: nullableText(row, 'finished_at'),
  }
}

function mapNotification(row: Row): NotificationRecord {
  return {
    id: integer(row, 'id'),
    taskId: nullableText(row, 'task_id'),
    kind: text(row, 'kind') as NotificationKind,
    title: text(row, 'title'),
    message: text(row, 'message'),
    createdAt: text(row, 'created_at'),
    readAt: nullableText(row, 'read_at'),
    resolvedAt: nullableText(row, 'resolved_at'),
  }
}
