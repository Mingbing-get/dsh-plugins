import { ToolArgsError } from '@deepseek-ai/dsh-tools'
import type { ValidationResult } from '../shared/index.ts'

export const output = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: { ok: { type: 'boolean', required: true } },
  },
  render: (_args: unknown, value: { ok: boolean }) => [
    { type: 'text' as const, text: JSON.stringify(value) },
  ],
} as const

export function completeAfterValidation(result: ValidationResult): { ok: true } {
  if (result.isError) throw new ToolArgsError([result.msg])
  return { ok: true }
}
