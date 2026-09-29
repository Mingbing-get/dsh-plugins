/**
 * DSH execution sessions.
 *
 * The orchestrator never drives a model inline: decomposition and each task run
 * happen in their own `ctx.agents.create()` session with its own prompt, so a
 * failed task cannot corrupt the interactive conversation.
 */

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'

/** One prompt to execute in an isolated session. */
export interface AgentRunRequest {
  /** Short label used in logs and the session id. */
  label: string
  /** Full instruction text handed to the model. */
  instructions: string
  /** Working directory of the child session. */
  cwd: string
  /** Caller-chosen session id (recorded in the attempt row before the run). */
  sessionId: string
  /** Wall-clock budget before the session is cancelled. */
  timeoutMs: number
  /** Outer cancellation (plugin teardown). */
  signal: AbortSignal
}

/** Result of one isolated session. */
export interface AgentRunResult {
  sessionId: string
  timedOut: boolean
}

/** Isolated model session runner. */
export interface AgentRunner {
  run(request: AgentRunRequest): Promise<AgentRunResult>
}

/** Thrown when a session exceeded its wall-clock budget. */
export class AgentTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`执行会话超过 ${String(timeoutMs)}ms 未结束，已取消`)
    this.name = 'AgentTimeoutError'
  }
}

function waitForIdle(agent: Agent, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      agent.cancel({ kind: 'parent' })
      reject(new Error('execution session aborted'))
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    agent.whenIdle().then(
      () => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

/**
 * Build the production agent runner backed by the DSH agent registry.
 * @param ctx - host plugin context.
 * @returns a runner that creates and drives one session per request.
 */
export function createDshAgentRunner(ctx: Context): AgentRunner {
  return {
    async run(request: AgentRunRequest): Promise<AgentRunResult> {
      const sessionId = SessionId(request.sessionId)
      const selection = ctx.get('agentDefaultModel')?.currentSelection()
      const timeout = AbortSignal.timeout(request.timeoutMs)
      const signal = AbortSignal.any([request.signal, timeout])
      const handle = await ctx.agents.create({
        sessionId,
        meta: { cwd: request.cwd, origin: 'subagent' },
        signal,
        ...(selection === undefined
          ? {}
          : { agentOptions: { provider: selection.provider, model: selection.model } }),
      })
      try {
        handle.agent.followup(
          createUserMessage({
            content: [{ type: 'text', text: request.instructions }],
            source: { kind: 'user' },
          }),
        )
        try {
          await waitForIdle(handle.agent, signal)
        } catch (error) {
          if (timeout.aborted && !request.signal.aborted) {
            throw new AgentTimeoutError(request.timeoutMs)
          }
          throw error
        }
      } finally {
        await handle.dispose().catch(() => undefined)
      }
      return { sessionId, timedOut: timeout.aborted }
    },
  }
}
