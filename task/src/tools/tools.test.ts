import { describe, expect, it } from 'vitest'
import { assertSupportedJsonSchema } from '@deepseek-ai/dsh-tools/src/json-schema.ts'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Workspace, WorkspaceResolver } from '../workspace/registry.ts'
import { TASK_TOOL_NAMES } from './index.ts'
import { requirementConfirmTool, requirementDraftTool } from './requirement.ts'
import { systemFeaturesApplyTool, systemFeaturesReadTool } from './features.ts'
import { planCreateTool, progressTool, queryTool, retryTool, skipTool } from './tasks.ts'

const resolve: WorkspaceResolver = () => ({}) as unknown as Workspace

function definitions(): ToolDefinition[] {
  return [
    requirementDraftTool(resolve),
    requirementConfirmTool(resolve),
    systemFeaturesReadTool(resolve),
    systemFeaturesApplyTool(resolve),
    planCreateTool(resolve),
    queryTool(resolve),
    progressTool(resolve),
    retryTool(resolve),
    skipTool(resolve),
  ]
}

describe('task tool contract', () => {
  it('registers exactly the documented tool names', () => {
    const names = definitions().map((definition) => definition.name)
    expect(names).toEqual([...TASK_TOOL_NAMES])
    expect(new Set(names).size).toBe(names.length)
  })

  it('declares schemas the tool registry accepts', () => {
    for (const definition of definitions()) {
      expect(definition.description.length, definition.name).toBeGreaterThan(10)
      // Output schemas are validated verbatim at registration time.
      assertSupportedJsonSchema(definition.output.schema)
      // `defineTool` already compiled the parameter spec; the registry then
      // validates the resulting JSON Schema verbatim.
      assertSupportedJsonSchema(definition.parameters)
      expect(definition.parameters.type, definition.name).toBe('object')
    }
  })

  it('marks the arguments that must never be omitted', () => {
    expect(planCreateTool(resolve).parameters.required).toContain('tasks')
    expect(progressTool(resolve).parameters.required).toEqual(
      expect.arrayContaining(['taskId', 'status']),
    )
    expect(retryTool(resolve).parameters.required).toEqual(
      expect.arrayContaining(['taskId', 'reason']),
    )
  })
})
