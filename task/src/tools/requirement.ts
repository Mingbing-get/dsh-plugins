/**
 * Requirement tools: `task_requirement_draft` (clarify + generate the document)
 * and `task_requirement_confirm` (human confirmation → feature overview →
 * commit → decomposition).
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { WorkspaceResolver } from '../workspace/registry.ts'
import { FEATURE_STATES, card, fail, jsonResult, objectOutput } from './shared.ts'

/** `task_requirement_draft`: one clarification round. */
export function requirementDraftTool(resolve: WorkspaceResolver): ToolDefinition {
  return defineTool({
    name: 'task_requirement_draft',
    description:
      '提交一轮需求梳理结果。openQuestions 非空时工具会向用户提问并把答案返回给你（继续迭代）；为空且事实齐备时生成 docs/products/<slug>.md 并把需求置为 pending_confirmation，等待用户确认。',
    parameters: {
      title: { type: 'string', required: true, description: '需求标题。' },
      slug: { type: 'string', description: 'ASCII 短横线短名；省略时由 title 推导。' },
      background: { type: 'string', required: true, description: '背景与目标说明。' },
      goals: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: '本次目标。',
      },
      nonGoals: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: '明确不做的范围。',
      },
      functionalRequirements: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string', required: true },
            detail: { type: 'string', required: true },
          },
        },
        description: '功能需求条目。',
      },
      featureDeltas: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            op: { type: 'string', required: true, enum: ['add', 'update', 'remove'] },
            domain: { type: 'string', required: true },
            name: { type: 'string', required: true },
            behavior: { type: 'string' },
            state: { type: 'string', enum: FEATURE_STATES },
            taskIds: { type: 'array', items: { type: 'string' } },
          },
        },
        description: '本次需求带来的系统功能更新点（确认时增量合并进 system-features.md）。',
      },
      technicalConstraints: { type: 'string', required: true, description: '技术约束与数据结构。' },
      acceptance: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: '可验收的验收标准。',
      },
      openQuestions: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true },
            question: { type: 'string', required: true },
            detail: { type: 'string' },
            options: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  label: { type: 'string', required: true },
                  description: { type: 'string' },
                },
              },
            },
          },
        },
        description: '仍未确认的事实；非空时工具会向用户提问。空数组表示需求已闭环。',
      },
    },
    output: objectOutput,
    async execute(args, exec) {
      try {
        const { service } = resolve(exec.agent)
        return jsonResult(
          await service.draftRequirement(
            {
              title: args.title,
              ...(args.slug === undefined ? {} : { slug: args.slug }),
              background: args.background,
              goals: [...args.goals],
              nonGoals: [...args.nonGoals],
              functionalRequirements: args.functionalRequirements.map((item) => ({ ...item })),
              featureDeltas: args.featureDeltas.map((delta) => ({
                op: delta.op,
                domain: delta.domain,
                name: delta.name,
                ...(delta.behavior === undefined ? {} : { behavior: delta.behavior }),
                ...(delta.state === undefined ? {} : { state: delta.state }),
                ...(delta.taskIds === undefined ? {} : { taskIds: [...delta.taskIds] }),
              })),
              technicalConstraints: args.technicalConstraints,
              acceptance: [...args.acceptance],
              openQuestions: args.openQuestions.map((question) => ({
                id: question.id,
                question: question.question,
                ...(question.detail === undefined ? {} : { detail: question.detail }),
                ...(question.options === undefined
                  ? {}
                  : { options: question.options.map((option) => ({ ...option })) }),
              })),
            },
            {
              ...(exec.agent === undefined ? {} : { agentId: exec.agent.id, agent: exec.agent }),
              signal: exec.signal,
            },
          ),
        )
      } catch (error) {
        fail(error)
      }
    },
    presentCall: (args) => card('梳理需求', args),
  })
}

/**
 * `task_requirement_confirm`: explicit human confirmation.
 *
 * After the user approves, the tool performs the fixed order required by the
 * product document: merge the feature overview → commit both documents → start
 * the independent decomposition session.
 * @param service - orchestrator service.
 * @param planner - decomposition session runner; omit to only return the instruction.
 */
export function requirementConfirmTool(resolve: WorkspaceResolver): ToolDefinition {
  return defineTool({
    name: 'task_requirement_confirm',
    description:
      '请用户确认需求文档。用户确认后：把功能更新点增量合并进 docs/products/system-features.md，提交产品文档与功能全景，置为 confirmed，并立即启动独立的拆解会话创建任务。未确认不得拆解。',
    parameters: {
      productId: { type: 'integer', description: '需求主键；与 slug 二选一。' },
      slug: { type: 'string', description: '需求 slug；与 productId 二选一。' },
      confirmed: {
        type: 'boolean',
        description: '仅在没有交互问答通道时使用：用户的显式确认结果。',
      },
    },
    output: objectOutput,
    async execute(args, exec) {
      try {
        const { service, planner } = resolve(exec.agent)
        const confirmed = await service.confirmRequirement(
          {
            ...(args.productId === undefined ? {} : { productId: args.productId }),
            ...(args.slug === undefined ? {} : { slug: args.slug }),
            ...(args.confirmed === undefined ? {} : { confirmed: args.confirmed }),
          },
          {
            ...(exec.agent === undefined ? {} : { agent: exec.agent }),
            signal: exec.signal,
          },
        )
        if (!confirmed.approved) return jsonResult(confirmed)
        const decomposition = await planner.decompose(confirmed.product, exec.signal)
        return jsonResult({
          ...confirmed,
          decomposition: {
            sessionId: decomposition.sessionId,
            warning: decomposition.warning,
            tasks: decomposition.tasks.map((task) => ({
              taskId: task.id,
              title: task.title,
              status: task.status,
              dependsOn: task.dependsOn,
              documentPath: task.documentPath,
            })),
          },
          instruction:
            decomposition.tasks.length > 0
              ? `已拆解为 ${String(decomposition.tasks.length)} 个任务并入库，调度器会自动按依赖执行；请汇报任务清单与依赖关系，不要再手工创建任务。`
              : '拆解会话没有创建任务，请根据产品文档调用 task_plan_create 手工拆解。',
        })
      } catch (error) {
        fail(error)
      }
    },
    presentCall: (args) => card('确认需求', args),
  })
}
