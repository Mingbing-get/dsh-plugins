/**
 * Decomposition and task-control tools.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { WorkspaceResolver } from '../workspace/registry.ts'
import { card, fail, jsonResult, objectOutput } from './shared.ts'

const ESTIMATES = ['S', 'M', 'L'] as const
const PROGRESS_STATUSES = ['running', 'failed', 'blocked', 'done'] as const
const TASK_STATUSES = ['pending', 'running', 'done', 'failed', 'blocked', 'cancelled'] as const

/** `task_plan_create`: store a decomposition result (never executes). */
export function planCreateTool(resolve: WorkspaceResolver): ToolDefinition {
  return defineTool({
    name: 'task_plan_create',
    description:
      '把已确认需求拆解为可执行任务并入库（含依赖关系与任务文档）。只入库、不执行；工具会做环检测与字段校验，非法 DAG 整批拒绝。',
    parameters: {
      productId: { type: 'integer', description: '需求主键；与 slug 二选一。' },
      slug: { type: 'string', description: '需求 slug；与 productId 二选一。' },
      tasks: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            key: {
              type: 'string',
              required: true,
              description: '本批次内唯一标识，供 dependsOn 引用。',
            },
            title: { type: 'string', required: true },
            slug: { type: 'string' },
            goal: { type: 'string', required: true, description: '任务背景与目标。' },
            acceptance: { type: 'string', required: true, description: '验收标准，逐行书写。' },
            scope: { type: 'array', items: { type: 'string' } },
            dependsOn: { type: 'array', items: { type: 'string' } },
            estimate: { type: 'string', enum: ESTIMATES },
            priority: { type: 'integer', description: '越小越先执行，默认 100。' },
            verifyCommands: { type: 'array', items: { type: 'string' } },
            risks: { type: 'string' },
            rollback: { type: 'string' },
          },
        },
      },
    },
    output: objectOutput,
    async execute(args, exec) {
      try {
        const { service } = resolve(exec.agent)
        const result = await service.plan({
          ...(args.productId === undefined ? {} : { productId: args.productId }),
          ...(args.slug === undefined ? {} : { slug: args.slug }),
          tasks: args.tasks.map((task) => ({
            key: task.key,
            title: task.title,
            ...(task.slug === undefined ? {} : { slug: task.slug }),
            goal: task.goal,
            acceptance: task.acceptance,
            ...(task.scope === undefined ? {} : { scope: [...task.scope] }),
            ...(task.dependsOn === undefined ? {} : { dependsOn: [...task.dependsOn] }),
            ...(task.estimate === undefined ? {} : { estimate: task.estimate }),
            ...(task.priority === undefined ? {} : { priority: task.priority }),
            ...(task.verifyCommands === undefined
              ? {}
              : { verifyCommands: [...task.verifyCommands] }),
            ...(task.risks === undefined ? {} : { risks: task.risks }),
            ...(task.rollback === undefined ? {} : { rollback: task.rollback }),
          })),
        })
        return jsonResult({
          productId: result.productId,
          productSlug: result.slug,
          docsCommit: result.docsCommit,
          warning: result.warning,
          tasks: result.tasks.map((task) => ({
            taskId: task.id,
            title: task.title,
            status: task.status,
            dependsOn: task.dependsOn,
            documentPath: task.documentPath,
          })),
          instruction: result.instruction,
        })
      } catch (error) {
        fail(error)
      }
    },
    presentCall: (args) => card('拆解任务', args),
  })
}

/** `task_query`: read-only inspection. */
export function queryTool(resolve: WorkspaceResolver): ToolDefinition {
  return defineTool({
    name: 'task_query',
    description:
      '查询任务列表、详情、依赖与可执行状态，以及系统功能全景摘要。只读，任何时候都可安全调用。',
    parameters: {
      taskId: {
        type: 'string',
        description: '任务编号（如 T3）；给出时返回详情、执行记录与事件。',
      },
      status: { type: 'string', enum: TASK_STATUSES, description: '按状态过滤。' },
      productId: { type: 'integer', description: '按来源需求过滤。' },
      includeBlocked: { type: 'boolean', description: 'false 时过滤掉 blocked 任务，默认包含。' },
    },
    output: objectOutput,
    async execute(args, exec) {
      try {
        return jsonResult(
          resolve(exec.agent).service.query({
            ...(args.taskId === undefined ? {} : { taskId: args.taskId }),
            ...(args.status === undefined ? {} : { status: args.status }),
            ...(args.productId === undefined ? {} : { productId: args.productId }),
            ...(args.includeBlocked === undefined ? {} : { includeBlocked: args.includeBlocked }),
          }),
        )
      } catch (error) {
        fail(error)
      }
    },
    presentCall: (args) => card('查询任务', args),
  })
}

/** `task_progress`: execution-phase reporting. */
export function progressTool(resolve: WorkspaceResolver): ToolDefinition {
  return defineTool({
    name: 'task_progress',
    description:
      '执行阶段上报进度：running 记录进展，failed 上报无法完成（下游转阻塞），blocked 上报阻塞，done 只是完成声明（编排器会独立校验提交与验收后才标记 done）。',
    parameters: {
      taskId: { type: 'string', required: true, description: '任务编号。' },
      status: { type: 'string', required: true, enum: PROGRESS_STATUSES },
      note: { type: 'string', description: '进展或失败原因说明。' },
      commit: { type: 'string', description: '如已产生提交，可一并上报（编排器会核对）。' },
    },
    output: objectOutput,
    async execute(args, exec) {
      try {
        return jsonResult(
          resolve(exec.agent).service.reportProgress({
            taskId: args.taskId,
            status: args.status,
            ...(args.note === undefined ? {} : { note: args.note }),
            ...(args.commit === undefined ? {} : { commit: args.commit }),
          }),
        )
      } catch (error) {
        fail(error)
      }
    },
    presentCall: (args) => card('上报任务进度', args),
  })
}

/** `task_retry`: human re-queue. */
export function retryTool(resolve: WorkspaceResolver): ToolDefinition {
  return defineTool({
    name: 'task_retry',
    description: '人工重试失败、阻塞或中断的任务：回到 pending 并释放被阻塞的下游任务。',
    parameters: {
      taskId: { type: 'string', required: true },
      reason: { type: 'string', required: true, description: '重试原因，会记入事件。' },
    },
    output: objectOutput,
    async execute(args, exec) {
      try {
        return jsonResult(await resolve(exec.agent).service.retryTask(args.taskId, args.reason))
      } catch (error) {
        fail(error)
      }
    },
    presentCall: (args) => card('重试任务', args),
  })
}

/** `task_skip`: human skip. */
export function skipTool(resolve: WorkspaceResolver): ToolDefinition {
  return defineTool({
    name: 'task_skip',
    description: '人工跳过任务：标记 cancelled 并释放被阻塞的下游任务继续调度。',
    parameters: {
      taskId: { type: 'string', required: true },
      reason: { type: 'string', required: true, description: '跳过原因，会记入事件。' },
    },
    output: objectOutput,
    async execute(args, exec) {
      try {
        return jsonResult(await resolve(exec.agent).service.skipTask(args.taskId, args.reason))
      } catch (error) {
        fail(error)
      }
    },
    presentCall: (args) => card('跳过任务', args),
  })
}
