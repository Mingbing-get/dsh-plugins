/**
 * Scheduler.
 *
 * Triggers (task added, task completed, plugin start, manual command, periodic
 * fallback) all funnel into one serialized scan, so a burst of events can never
 * start two tasks at once. A database lease additionally keeps two processes
 * from driving the same repository.
 */

import { randomUUID } from 'node:crypto'
import { OrchestratorService } from '../service.ts'
import type { OrchestratorLogger } from '../service.ts'
import { TaskRunner } from '../runner/runner.ts'
import type { TaskOrchestratorOptions } from '../domain/config.ts'
import { describeError } from '../domain/errors.ts'

/** Collaborators of the scheduler. */
export interface SchedulerDeps {
  service: OrchestratorService
  runner: TaskRunner
  logger: OrchestratorLogger
  options: TaskOrchestratorOptions
  /** Instance identity used by the database lease. */
  owner?: string
  /** Test seam: disable the periodic timer. */
  enableTimer?: boolean
}

/** Serial task scheduler and recovery loop. */
export class Scheduler {
  private readonly service: OrchestratorService
  private readonly runner: TaskRunner
  private readonly logger: OrchestratorLogger
  private readonly options: TaskOrchestratorOptions
  private readonly owner: string
  private readonly enableTimer: boolean
  private readonly abort = new AbortController()

  private queue: Promise<void> = Promise.resolve()
  private timer: NodeJS.Timeout | null = null
  private pending: NodeJS.Timeout | null = null
  private disposed = false

  constructor(deps: SchedulerDeps) {
    this.service = deps.service
    this.runner = deps.runner
    this.logger = deps.logger
    this.options = deps.options
    this.owner = deps.owner ?? `task-orchestrator-${String(process.pid)}-${randomUUID()}`
    this.enableTimer = deps.enableTimer ?? true
  }

  /** Start the periodic fallback scan and run the first scan immediately. */
  start(): void {
    if (this.disposed) return
    if (this.enableTimer && this.timer === null) {
      this.timer = setInterval(() => this.trigger('interval'), this.options.scanIntervalMs)
      this.timer.unref?.()
    }
    this.trigger('startup')
  }

  /** Stop timers and cancel an in-flight execution. */
  dispose(): void {
    this.disposed = true
    if (this.timer !== null) clearInterval(this.timer)
    if (this.pending !== null) clearTimeout(this.pending)
    this.timer = null
    this.pending = null
    this.abort.abort()
  }

  /**
   * Request a scan. Concurrent requests are serialized behind the running one.
   * @param reason - diagnostic reason recorded in the log.
   * @param delayMs - optional delay (retry backoff) before the request lands.
   */
  trigger(reason: string, delayMs?: number): void {
    if (this.disposed) return
    if (delayMs !== undefined && delayMs > 0) {
      if (this.pending !== null) clearTimeout(this.pending)
      this.pending = setTimeout(() => {
        this.pending = null
        this.trigger(reason)
      }, delayMs)
      this.pending.unref?.()
      return
    }
    this.queue = this.queue
      .then(() => this.scan(reason))
      .catch((error: unknown) => {
        this.logger.error(`task-orchestrator: 扫描失败：${describeError(error)}`)
      })
  }

  /** Wait until every queued scan settled (tests and shutdown). */
  async drain(): Promise<void> {
    await this.queue
  }

  private async scan(reason: string): Promise<void> {
    if (this.disposed) return
    const leaseMs = Math.max(this.options.scanIntervalMs * 3, 30_000)
    if (!this.service.store.acquireLock('scheduler', this.owner, leaseMs)) {
      this.logger.info(`task-orchestrator: 另一个进程持有调度锁，跳过本次扫描（${reason}）`)
      return
    }
    // A task run can outlive one lease, so renew it while the scan owns the lock.
    const heartbeat = setInterval(
      () => {
        this.service.store.acquireLock('scheduler', this.owner, leaseMs)
      },
      Math.max(Math.floor(leaseMs / 3), 5_000),
    )
    heartbeat.unref?.()
    try {
      const recovered = await this.service.recoverInterrupted()
      for (const task of recovered) {
        this.logger.warn(`task-orchestrator: 回收中断任务 ${task.id}（${task.status}）`)
      }

      let executed = 0
      for (;;) {
        if (this.disposed || this.abort.signal.aborted) return
        const next = this.service.store.executableTasks()[0]
        if (next === undefined) break
        this.logger.info(`task-orchestrator: 选中 ${next.id} 执行（触发：${reason}）`)
        const outcome = await this.runner.run(next.id, this.abort.signal)
        executed += 1
        if (outcome.kind !== 'done') {
          // A failed task may have been re-queued for a backoff retry; do not
          // spin on it in this scan.
          break
        }
        if (executed > 1000) {
          this.logger.warn('task-orchestrator: 单次扫描执行任务数达到上限，交由下一次扫描继续')
          break
        }
      }

      if (executed === 0) {
        const counts = this.service.store.countByStatus()
        if (counts.pending > 0 || counts.blocked > 0 || counts.failed > 0) {
          this.logger.info(
            `task-orchestrator: 无可执行任务（pending=${String(counts.pending)} blocked=${String(counts.blocked)} failed=${String(counts.failed)}），等待下一次触发`,
          )
        }
      }
    } finally {
      clearInterval(heartbeat)
      this.service.store.releaseLock('scheduler', this.owner)
    }
  }
}
