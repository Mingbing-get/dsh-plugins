/**
 * Decomposition session.
 *
 * The product document (§5.3.1) requires decomposition to run in its own model
 * session rather than inline in the interactive conversation: the planner reads
 * the confirmed document and calls `task_plan_create`, and this module reports
 * what that session stored. Like task execution, the session is surfaced in the
 * user's session list (title `拆解需求 <slug>`) unless the plugin option
 * `exposeOrchestratorSessions` turns that off.
 */

import type { AgentRunner } from './session.ts'
import { plannerInstructions } from './prompts.ts'
import { OrchestratorService } from '../service.ts'
import type { OrchestratorLogger } from '../service.ts'
import { describeError } from '../domain/errors.ts'
import type { TaskOrchestratorOptions } from '../domain/config.ts'
import type { ProductRecord, TaskRecord } from '../domain/types.ts'

/** Result of one decomposition session. */
export interface DecompositionResult {
  sessionId: string
  /** Tasks stored by the session, empty when the model never called the tool. */
  tasks: TaskRecord[]
  /** Non-null when the session failed; the caller may fall back to manual planning. */
  warning: string | null
}

/** Runs the confirmed requirement through an isolated decomposition session. */
export class Planner {
  private readonly service: OrchestratorService
  private readonly agents: AgentRunner
  private readonly options: TaskOrchestratorOptions
  private readonly logger: OrchestratorLogger
  private sequence = 0

  constructor(deps: {
    service: OrchestratorService
    agents: AgentRunner
    options: TaskOrchestratorOptions
    logger: OrchestratorLogger
  }) {
    this.service = deps.service
    this.agents = deps.agents
    this.options = deps.options
    this.logger = deps.logger
  }

  /**
   * Decompose one confirmed requirement.
   * @param product - confirmed product requirement.
   * @param signal - cancellation signal inherited from the calling tool.
   */
  async decompose(product: ProductRecord, signal: AbortSignal): Promise<DecompositionResult> {
    const existing = this.service.store.listTasks({ productId: product.id })
    if (existing.length > 0) {
      // Idempotent: a re-confirmation must not plan the same requirement twice.
      return { sessionId: 'none', tasks: existing, warning: null }
    }
    this.sequence += 1
    const label = `planner-${product.slug}-${String(this.sequence)}`
    const sessionId = `task-${label}-${String(Date.now())}`
    try {
      await this.agents.run({
        label,
        title: `拆解需求 ${product.slug}`,
        surface: this.options.exposeOrchestratorSessions,
        ...(this.options.agentPreset === undefined
          ? {}
          : { agentPreset: this.options.agentPreset }),
        instructions: plannerInstructions(product, product.documentPath),
        cwd: this.options.workspaceRoot,
        sessionId,
        timeoutMs: this.options.taskTimeoutMs,
        signal,
      })
    } catch (error) {
      const message = describeError(error)
      this.logger.warn(`task-orchestrator: 需求 ${product.slug} 的拆解会话失败：${message}`)
      return { sessionId, tasks: [], warning: message }
    }
    const tasks = this.service.store.listTasks({ productId: product.id })
    if (tasks.length === 0) {
      return {
        sessionId,
        tasks,
        warning: '拆解会话结束但没有创建任何任务，请人工检查产品文档是否可拆解',
      }
    }
    this.logger.info(
      `task-orchestrator: 需求 ${product.slug} 已拆解为 ${String(tasks.length)} 个任务（${tasks.map((task) => task.id).join('、')}）`,
    )
    return { sessionId, tasks, warning: null }
  }
}
