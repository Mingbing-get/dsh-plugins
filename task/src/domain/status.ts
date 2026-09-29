/**
 * Task state machine. The database applies transitions conditionally, and the
 * domain decides which transitions are legal, so an illegal move fails with an
 * actionable error instead of silently corrupting the schedule.
 */

import { illegalTransition } from './errors.ts'
import type { TaskStatus } from './types.ts'

/** Every task status, in lifecycle order. */
export const TASK_STATUSES: readonly TaskStatus[] = [
  'pending',
  'running',
  'blocked',
  'done',
  'failed',
  'cancelled',
]

/** Statuses a task never leaves without an explicit human decision. */
export const TERMINAL_STATUSES: readonly TaskStatus[] = ['done', 'cancelled']

/** Statuses that still need scheduler attention. */
export const ACTIVE_STATUSES: readonly TaskStatus[] = ['pending', 'running', 'blocked', 'failed']

const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  // Selected by the scheduler, blocked by a failed/skipped upstream, rejected
  // by the preflight checks, or cancelled.
  pending: ['running', 'blocked', 'failed', 'cancelled'],
  // Success, exhausted retries, re-queued for a retry, upstream failure, or cancel.
  running: ['done', 'failed', 'pending', 'blocked', 'cancelled'],
  // Released by a human retry/skip of the upstream task, or cancelled.
  blocked: ['pending', 'cancelled'],
  // A human retry re-queues it.
  failed: ['pending', 'cancelled'],
  // Reopened explicitly by a human.
  done: ['pending'],
  cancelled: ['pending'],
}

/** Whether a transition is allowed by the state machine. */
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

/**
 * Throw unless the transition is allowed.
 * @param from - current status.
 * @param to - requested status.
 * @param subject - short identifier used in the error message.
 */
export function assertTransition(from: TaskStatus, to: TaskStatus, subject: string): void {
  if (canTransition(from, to)) return
  throw illegalTransition(
    `${subject} 不能从 ${from} 迁移到 ${to}（允许：${TRANSITIONS[from].join('、')}）`,
    { from, to, allowed: TRANSITIONS[from] },
  )
}

/** Whether the status is terminal. */
export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

/** Parse an untrusted status string. */
export function parseTaskStatus(value: unknown): TaskStatus {
  if (typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value)) {
    return value as TaskStatus
  }
  throw illegalTransition(`未知的任务状态：${String(value)}`, { value })
}
