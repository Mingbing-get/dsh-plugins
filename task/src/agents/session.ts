/**
 * DSH execution sessions.
 *
 * The orchestrator never drives a model inline: decomposition and each task run
 * happen in their own `ctx.agents.create()` session with its own prompt, so a
 * failed task cannot corrupt the interactive conversation.
 *
 * Two kinds of run exist:
 * - **Surfaced** (`surface: true`, the default posture): an ordinary session with
 *   the target repository as `cwd`, attached to that directory's workspace and
 *   given an explicit title. It therefore shows up in the Web frontend exactly
 *   like a conversation the user started there, and its stream can be watched
 *   live while the run is in flight. Both task execution and decomposition run
 *   this way.
 * - **Internal** (`surface` off, plugin option `exposeOrchestratorSessions`):
 *   `origin: 'subagent'`, deliberately hidden from every navigation surface —
 *   the orchestrator then works without leaving rows in the user's session list.
 *
 * Every run is composed from an **agent preset**. Since the agent plane moved
 * behind presets, a session that joins none reads only the host plane — in the
 * Web profile that is this plugin's own `task_*` tools and nothing else, because
 * `tool-fs`, `tool-bash` and friends are preset rows there. A run without a
 * preset can neither read the task document nor touch the repository, so the
 * composition is resolved here exactly like `session.create` does it: the roster
 * default (what the frontend mounts for a conversation the user starts) unless
 * the plugin config names another preset.
 */

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { describeError } from '../domain/errors.ts'

/** One prompt to execute in an isolated session. */
export interface AgentRunRequest {
  /** Short label used in logs and the session id. */
  label: string
  /**
   * Title pinned on a surfaced session. Ignored by internal runs, whose titles
   * are never shown.
   */
  title?: string
  /**
   * Surface this run as an ordinary conversation in the user's session list.
   *
   * Defaults to `false` (internal subagent session). A surfaced run omits
   * `origin`, so the Web frontend lists it under the workspace owning {@link cwd}
   * and streams it once opened.
   */
  surface?: boolean
  /**
   * Agent preset this run is composed from (plugin option `agentPreset`).
   * `undefined` asks the roster for its default — the preset the Web frontend
   * mounts when the user starts a conversation.
   */
  agentPreset?: string
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

/** Minimal host-side title face; the service is optional in a deployment. */
interface SessionTitleFace {
  rename(session: Session, title: string): unknown
}

/** One workspace record the runner may attach a surfaced session to. */
interface AttachableWorkspace {
  attachSession(sessionId: SessionId): Promise<void>
}

/** Minimal host-side workspace face; absent outside the Web composition. */
interface WorkspaceRegistryFace {
  resolveByPath(path: string): Promise<AttachableWorkspace | undefined>
  create(path: string, title?: string): Promise<AttachableWorkspace>
}

/** One preset record the roster resolved, as far as the runner reads it. */
interface AgentPresetFace {
  id: string
}

/**
 * Minimal host-side preset face.
 *
 * Both calls are the public roster API `session.create` uses; the service is
 * absent from a deployment with no preset roots, where every session shares the
 * host composition instead.
 */
interface AgentPresetsFace {
  resolve(id?: string): Promise<AgentPresetFace>
  mount(agentCtx: Context, id?: string): Promise<unknown>
}

/**
 * Make one execution session discoverable in the user's session list.
 *
 * Both steps are best-effort: a missing service, a title rejection, or an
 * unwritable workspace registry must never fail the task run itself. The
 * session is created with its repository as `cwd`, so an existing workspace for
 * that directory adopts it; a directory nobody registered becomes a workspace,
 * mirroring what the frontend does when a conversation starts there.
 * @param ctx - host plugin context.
 * @param session - the live session just created.
 * @param request - the run the session belongs to.
 */
async function surfaceSession(
  ctx: Context,
  session: Session,
  request: AgentRunRequest,
): Promise<void> {
  if (request.title !== undefined) {
    try {
      const titles = ctx.get('sessionTitle') as SessionTitleFace | undefined
      titles?.rename(session, request.title)
    } catch (error) {
      ctx.logger.warn(`task-orchestrator: 执行会话标题写入失败：${describeError(error)}`)
    }
  }
  const registry = ctx.get('workspaceRegistry') as WorkspaceRegistryFace | undefined
  if (registry === undefined) return
  try {
    const workspace =
      (await registry.resolveByPath(request.cwd)) ?? (await registry.create(request.cwd))
    await workspace.attachSession(session.id)
  } catch (error) {
    ctx.logger.warn(`task-orchestrator: 执行会话未挂到工作区：${describeError(error)}`)
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
  let warnedNoRoster = false
  return {
    async run(request: AgentRunRequest): Promise<AgentRunResult> {
      const sessionId = SessionId(request.sessionId)
      const selection = ctx.get('agentDefaultModel')?.currentSelection()
      const timeout = AbortSignal.timeout(request.timeoutMs)
      const signal = AbortSignal.any([request.signal, timeout])
      // Resolved before `create` because the session boundary snapshots `meta`
      // first, and recorded on the header so a resumed or forked session
      // rebuilds the composition its history was produced under. Mounting
      // itself happens in `setup` (below), where a broken preset rolls the
      // whole creation back instead of publishing a session with no tools.
      const presets = ctx.get('agentPresets') as AgentPresetsFace | undefined
      if (presets === undefined && request.agentPreset !== undefined && !warnedNoRoster) {
        // A rosterless deployment keeps its model-facing tools in the host
        // composition, so the run still works — but the configured name is
        // honest only where a roster can honour it. Warned once: this is a
        // per-deployment fact, not a per-run one.
        warnedNoRoster = true
        ctx.logger.warn(
          `task-orchestrator: 部署未启用 agent preset，已忽略 agentPreset 配置「${request.agentPreset}」`,
        )
      }
      const presetId =
        presets === undefined ? undefined : (await presets.resolve(request.agentPreset)).id
      // A surfaced session carries no `origin`, which is exactly what keeps it
      // out of the frontend's subagent filter; an internal one is tagged so it
      // stays invisible everywhere.
      const meta = {
        cwd: request.cwd,
        ...(presetId === undefined ? {} : { agentPreset: presetId }),
        ...(request.surface === true ? {} : { origin: 'subagent' as const }),
      }
      const handle = await ctx.agents.create({
        sessionId,
        meta,
        signal,
        ...(presets === undefined || presetId === undefined
          ? {}
          : {
              setup: async (agentCtx: Context): Promise<void> => {
                await presets.mount(agentCtx, presetId)
              },
            }),
        ...(selection === undefined
          ? {}
          : { agentOptions: { provider: selection.provider, model: selection.model } }),
      })
      try {
        if (request.surface === true) {
          await surfaceSession(ctx, handle.agent.session, request)
        }
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
