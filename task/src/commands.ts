/**
 * `/task` session command. Every subcommand reuses the service or the
 * scheduler, so the command surface can never drift from the tool surface.
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { OrchestratorLogger } from './service.ts'
import type { AgentRunner } from './agents/session.ts'
import { analystInstructions } from './agents/prompts.ts'
import { sessionCwd } from './workspace/registry.ts'
import type { WorkspaceRegistry } from './workspace/registry.ts'
import { describeError } from './domain/errors.ts'
import type { TaskRecord } from './domain/types.ts'

/** Collaborators of the command surface. */
export interface CommandDeps {
  registry: WorkspaceRegistry
  agents: AgentRunner
  logger: OrchestratorLogger
}

const USAGE = [
  '可用子命令：',
  '- `/task start <需求描述>`：启动需求梳理会话',
  '- `/task list`：列出全部任务',
  '- `/task show T3`：查看任务详情与依赖',
  '- `/task run`：立即触发一次调度扫描',
  '- `/task retry T3`：重试失败/阻塞任务',
  '- `/task skip T3`：跳过任务并释放下游',
  '- `/task cancel`：取消所有未完成任务',
  '- `/task features`：查看系统功能全景摘要',
].join('\n')

function line(task: TaskRecord): string {
  const deps = task.dependsOn.length > 0 ? `（依赖 ${task.dependsOn.join('、')}）` : ''
  const blocked = task.blockedReason === null ? '' : `［${task.blockedReason}］`
  return `${task.id} [${task.status}] ${task.title}${deps}${blocked}`
}

/** Register the `/task` command. */
export function registerTaskCommand(ctx: Context, deps: CommandDeps): void {
  ctx.commands.register({
    name: 'task',
    description: '需求梳理、任务拆解与调度执行',
    input: { hint: '[start <需求描述>|list|show T3|run|retry T3|skip T3|cancel|features]' },
    handler: (invocation) => handle(deps, invocation),
  })
}

async function handle(deps: CommandDeps, invocation: CommandInvocation): Promise<CommandResult> {
  const raw = invocation.rawInput.trim()
  const [verb = '', ...rest] = raw.split(/\s+/u)
  const argument = rest.join(' ').trim()
  // Resolved lazily: `/task` with no arguments must not open a workspace.
  const workspace = (): ReturnType<WorkspaceRegistry['resolve']> =>
    deps.registry.resolve(sessionCwd(invocation.agent))
  try {
    switch (verb) {
      case '':
        return { kind: 'success', text: USAGE }
      case 'start': {
        if (argument.length === 0) return { kind: 'error', text: '用法：`/task start <需求描述>`' }
        const { service, options } = workspace()
        const label = `analyst-${randomUUID().slice(0, 8)}`
        await deps.agents.run({
          label,
          instructions: analystInstructions(argument),
          cwd: options.workspaceRoot,
          sessionId: `task-${label}`,
          timeoutMs: options.taskTimeoutMs,
          signal: invocation.signal,
        })
        const product = service.store.listProducts()[0]
        return {
          kind: 'success',
          text:
            product === undefined
              ? '需求梳理会话已结束，但尚未生成需求文档。'
              : `需求梳理会话已结束：${product.slug} 当前状态 ${product.status}（${product.documentPath}）。`,
        }
      }
      case 'list': {
        const tasks = workspace().service.store.listTasks()
        if (tasks.length === 0) return { kind: 'success', text: '当前没有任务。' }
        return { kind: 'success', text: tasks.map(line).join('\n') }
      }
      case 'show': {
        if (argument.length === 0) return { kind: 'error', text: '用法：`/task show T3`' }
        const detail = workspace().service.query({ taskId: argument })
        return { kind: 'success', text: JSON.stringify(detail, null, 2) }
      }
      case 'run': {
        workspace().scheduler.trigger('command-run')
        return { kind: 'success', text: '已触发调度扫描。' }
      }
      case 'retry': {
        if (argument.length === 0) return { kind: 'error', text: '用法：`/task retry T3`' }
        await workspace().service.retryTask(argument, '命令重试')
        return { kind: 'success', text: `已重新排队 ${argument}，下游阻塞任务已释放。` }
      }
      case 'skip': {
        if (argument.length === 0) return { kind: 'error', text: '用法：`/task skip T3`' }
        await workspace().service.skipTask(argument, '命令跳过')
        return { kind: 'success', text: `已跳过 ${argument}，下游阻塞任务已释放。` }
      }
      case 'cancel': {
        const result = await workspace().service.cancelAll('命令取消')
        const cancelled = result['cancelled']
        const count = Array.isArray(cancelled) ? cancelled.length : 0
        return { kind: 'success', text: `已取消 ${String(count)} 个未完成任务。` }
      }
      case 'features': {
        return { kind: 'success', text: workspace().service.readFeatures().digest }
      }
      default:
        return { kind: 'error', text: `未知子命令：${verb}\n${USAGE}` }
    }
  } catch (error) {
    deps.logger.error(`task-orchestrator: /task ${verb} 失败：${describeError(error)}`)
    return { kind: 'error', text: describeError(error) }
  }
}
