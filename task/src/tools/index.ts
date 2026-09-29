/**
 * Tool registration. The tools are the only write channel the model has, so
 * this list is the complete external contract of the plugin.
 *
 * Every tool resolves its workspace from the calling session's working
 * directory: the same process serves several repositories without mixing their
 * tasks, documents, or commits.
 */

import type { Context } from '@deepseek-ai/cordis'
import { sessionCwd } from '../workspace/registry.ts'
import type { WorkspaceRegistry, WorkspaceResolver } from '../workspace/registry.ts'
import { requirementConfirmTool, requirementDraftTool } from './requirement.ts'
import { systemFeaturesApplyTool, systemFeaturesReadTool } from './features.ts'
import { planCreateTool, progressTool, queryTool, retryTool, skipTool } from './tasks.ts'

/** Every tool name this plugin registers. */
export const TASK_TOOL_NAMES = [
  'task_requirement_draft',
  'task_requirement_confirm',
  'task_system_features_read',
  'task_system_features_apply',
  'task_plan_create',
  'task_query',
  'task_progress',
  'task_retry',
  'task_skip',
] as const

/**
 * Register the `task_*` tools on the host tool registry.
 * @param ctx - host plugin context.
 * @param registry - workspace registry backing every tool.
 */
export function registerTaskTools(ctx: Context, registry: WorkspaceRegistry): void {
  const resolve: WorkspaceResolver = (agent) => registry.resolve(sessionCwd(agent))
  for (const definition of [
    requirementDraftTool(resolve),
    requirementConfirmTool(resolve),
    systemFeaturesReadTool(resolve),
    systemFeaturesApplyTool(resolve),
    planCreateTool(resolve),
    queryTool(resolve),
    progressTool(resolve),
    retryTool(resolve),
    skipTool(resolve),
  ]) {
    ctx.tools.register(definition)
  }
}
