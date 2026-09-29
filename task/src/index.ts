/**
 * Task orchestrator host plugin.
 *
 * Wiring only: resolve the fallback options, build the workspace registry, and
 * mount the surfaces. Every artifact belongs to the workspace of the session
 * that asked for it — the AI's working directory — not to the directory the
 * process started in.
 *
 * Capability scoping: a service is only ever touched by a fiber that injects
 * it. The intervention panel and the `/task` command are therefore mounted as
 * *child* plugins declaring their own requirements (`connection` + `webServer`,
 * and `commands`), so a deployment without a web server or a command adapter
 * still gets the tools and the scheduler instead of failing to load.
 *
 * 产品与功能定义见 `task/docs/products/task-orchestrator.md`。
 */

import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-user-questions'
import type { AskRequest, OrchestratorLogger } from './service.ts'
import type { AgentRunner } from './agents/session.ts'
import { createDshAgentRunner } from './agents/session.ts'
import { ORCHESTRATOR_ROLE } from './agents/prompts.ts'
import { WorkspaceRegistry } from './workspace/registry.ts'
import { registerTaskTools } from './tools/index.ts'
import { registerTaskCommand } from './commands.ts'
import { installPanelBridge } from './bridge/panel.ts'
import { resolveOptions } from './domain/config.ts'
import type { TaskOrchestratorConfig } from './domain/config.ts'

export const name = 'task-orchestrator'

/**
 * Services the plugin body itself consumes.
 *
 * `connection`/`webServer` belong to the panel child plugin and `commands` to
 * the command child plugin — see {@link panelPlugin} and {@link commandPlugin}.
 */
export const inject = ['tools', 'agents', 'userQuestions', 'systemPrompt'] as const

/** Plugin configuration; every field is optional and defaulted by the schema. */
export type Config = TaskOrchestratorConfig

/**
 * Runtime schema for {@link Config}.
 *
 * `stateDir` and `databaseFile` deliberately carry no schema default: their
 * real defaults are environment-dependent (they resolve against the harness
 * home) and are applied by `resolveOptions`.
 */
export const Config = z.object({
  workspaceRoot: z.string(),
  stateDir: z.string(),
  databaseFile: z.string(),
  docsRoot: z.string().default('docs'),
  systemFeaturesFile: z.string().default('system-features.md'),
  maxRetries: z.number().step(1).min(0).default(2),
  retryBackoffMs: z.array(z.number().step(1).min(0)).default([30_000, 120_000]),
  scanIntervalMs: z.number().step(1).min(1000).default(30_000),
  maxClarifyRounds: z.number().step(1).min(1).default(8),
  requireCleanWorktree: z.boolean().default(true),
  taskTimeoutMs: z
    .number()
    .step(1)
    .min(1000)
    .default(30 * 60_000),
  commitMessageTemplate: z.string().default('feat({id}): {title}'),
  exposeOrchestratorSessions: z.boolean().default(true),
  enableScheduler: z.boolean().default(true),
}) as unknown as z<Config>

/** Child plugin shape used for the capability-scoped surfaces. */
export interface ChildPlugin {
  name: string
  inject: string[]
  apply(ctx: Context): void
}

function adapterLogger(ctx: Context): OrchestratorLogger {
  return {
    info: (message) => ctx.logger.info(message),
    warn: (message) => ctx.logger.warn(message),
    error: (message) => ctx.logger.error(message),
  }
}

function askBridge(ctx: Context): (request: AskRequest) => Promise<AskUserQuestionAnswer> {
  return async (request) =>
    ctx.userQuestions.ask({
      questions: request.questions.map((question) => ({
        id: question.id,
        question: question.question,
        ...(question.header === undefined ? {} : { header: question.header }),
        ...(question.detail === undefined ? {} : { detail: question.detail }),
        ...(question.options === undefined ? {} : { options: question.options }),
      })),
      ...(request.agent === undefined
        ? {}
        : { agent: request.agent as NonNullable<AskUserQuestionRequest['agent']> }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
}

/**
 * Panel child plugin.
 *
 * `webServer` is required on current DSH, where `connection.rpc.handle`
 * registers the physical route on the *calling* fiber; the installer catches
 * the failure on builds that register it on the connection plugin's own fiber
 * and falls back to exact Fetch routes on `/api`.
 * @param registry - workspace registry.
 * @param logger - plugin logger.
 */
export function panelPlugin(registry: WorkspaceRegistry, logger: OrchestratorLogger): ChildPlugin {
  return {
    name: 'task-orchestrator:panel',
    inject: ['connection', 'webServer'],
    apply(panelCtx: Context): void {
      const transport = installPanelBridge(panelCtx, registry, logger)
      logger.info(`task-orchestrator: 悬浮通知面板已注册（传输：${transport}）`)
    },
  }
}

/**
 * `/task` command child plugin.
 * @param deps - command collaborators.
 */
export function commandPlugin(deps: {
  registry: WorkspaceRegistry
  agents: AgentRunner
  logger: OrchestratorLogger
}): ChildPlugin {
  return {
    name: 'task-orchestrator:command',
    inject: ['commands'],
    apply(commandCtx: Context): void {
      registerTaskCommand(commandCtx, deps)
      deps.logger.info('task-orchestrator: /task 指令已注册')
    },
  }
}

/**
 * Install the task orchestrator.
 * @param ctx - host plugin context.
 * @param config - plugin configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const options = resolveOptions(config, process.cwd())
  const logger = adapterLogger(ctx)
  const agents = createDshAgentRunner(ctx)
  const registry = new WorkspaceRegistry({
    options,
    logger,
    agents,
    askUser: askBridge(ctx),
    enableScheduler: options.enableScheduler,
  })
  ctx.effect(() => () => registry.close(), 'task-orchestrator: workspaces')

  ctx.systemPrompt.context({
    name: 'task-orchestrator:role',
    order: 90,
    text: ORCHESTRATOR_ROLE,
  })

  registerTaskTools(ctx, registry)
  ctx.plugin(panelPlugin(registry, logger))
  ctx.plugin(commandPlugin({ registry, agents, logger }))

  // Serve every workspace the AI actually works in: a session's working
  // directory is the repository tasks must run against. Opening a workspace is
  // deferred and failure-tolerant — observing a session must never break it.
  const observe = (cwd: string | undefined): void => {
    queueMicrotask(() => {
      try {
        registry.observe(cwd)
      } catch (error) {
        logger.warn(
          `task-orchestrator: 观察会话工作区失败：${error instanceof Error ? error.message : String(error)}`,
        )
      }
    })
  }
  ctx.on('session/created', (session) => {
    if (session.header.origin === 'subagent') return
    observe(session.header.cwd)
  })
  for (const session of ctx.get('sessions')?.list() ?? []) {
    if (session.header.origin !== 'subagent') observe(session.header.cwd)
  }

  logger.info(
    `task-orchestrator: 已加载（按会话工作目录接管仓库；无 cwd 时回退 ${options.workspaceRoot}；状态目录 ${options.stateDir}）`,
  )
}
