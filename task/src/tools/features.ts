/**
 * System feature overview tools. `task_system_features_apply` is deliberately
 * delta-only: the model reads the current document first and then submits
 * entries, never a whole-file replacement.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { WorkspaceResolver } from '../workspace/registry.ts'
import { FEATURE_STATES, card, fail, jsonResult, objectOutput } from './shared.ts'

/** `task_system_features_read`: read the overview and its structure. */
export function systemFeaturesReadTool(resolve: WorkspaceResolver): ToolDefinition {
  return defineTool({
    name: 'task_system_features_read',
    description:
      '读取系统功能全景（docs/products/system-features.md）的全文结构：功能域、功能点、来源需求、状态、关联任务。写之前必须先读。',
    parameters: {},
    output: objectOutput,
    async execute(_args, exec) {
      try {
        const features = resolve(exec.agent).service.readFeatures()
        return jsonResult({
          documentPath: features.relativePath,
          exists: features.exists,
          lastUpdated: features.summary.lastUpdated,
          coveredSlugs: features.summary.coveredSlugs,
          domains: features.summary.domains.map((domain) => ({
            name: domain.name,
            entries: domain.entries.map((entry) => ({
              name: entry.name,
              source: entry.source,
              state: entry.state,
              behavior: entry.behavior,
              taskIds: entry.taskIds,
            })),
          })),
          digest: features.digest,
        })
      } catch (error) {
        fail(error)
      }
    },
    presentCall: (args) => card('读取系统功能全景', args),
  })
}

/** `task_system_features_apply`: incremental merge. */
export function systemFeaturesApplyTool(resolve: WorkspaceResolver): ToolDefinition {
  return defineTool({
    name: 'task_system_features_apply',
    description:
      '把功能更新点增量合并进系统功能全景。只能提交条目级增量（add/update/remove），工具内部按功能域合并并禁止整篇替换；已有条目除被本次明确修改外保持原文。',
    parameters: {
      slug: { type: 'string', required: true, description: '来源需求 slug。' },
      deltas: {
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
      },
      note: { type: 'string', description: '追加到变更记录里的一句说明。' },
    },
    output: objectOutput,
    async execute(args, exec) {
      try {
        const { service } = resolve(exec.agent)
        const result = service.applyFeatures(
          args.slug,
          args.deltas.map((delta) => ({
            op: delta.op,
            domain: delta.domain,
            name: delta.name,
            ...(delta.behavior === undefined ? {} : { behavior: delta.behavior }),
            ...(delta.state === undefined ? {} : { state: delta.state }),
            ...(delta.taskIds === undefined ? {} : { taskIds: [...delta.taskIds] }),
          })),
          { ...(args.note === undefined ? {} : { note: args.note }) },
        )
        const features = service.readFeatures()
        return jsonResult({
          documentPath: features.relativePath,
          changes: result.changes,
          coveredSlugs: features.summary.coveredSlugs,
          instruction: '增量已合并。若要提交到 git，请按仓库流程处理文档提交。',
        })
      } catch (error) {
        fail(error)
      }
    },
    presentCall: (args) => card('更新系统功能全景', args),
  })
}
