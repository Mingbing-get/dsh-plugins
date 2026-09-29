/**
 * Shared tool plumbing: one canonical output declaration and one error bridge
 * so every `task_*` tool fails with an actionable message instead of a stack.
 */

import { ToolArgsError } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-tools'
import { DomainError } from '../domain/errors.ts'

/** Every task tool returns a JSON object; the shape is documented per tool. */
export const objectOutput = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args: unknown, value: unknown) => [
    { type: 'text' as const, text: JSON.stringify(value, null, 2) },
  ],
} as const

/**
 * Normalize a tool result to the canonical lossless-JSON object the registry
 * requires (drops `undefined` members and any non-JSON value).
 * @param value - plain result object.
 * @returns a JSON-safe record.
 */
export function jsonResult(value: unknown): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value ?? {})) as Record<string, JsonValue>
}

/** Feature state vocabulary shared by the feature tools. */
export const FEATURE_STATES = ['待实现', '实现中', '已实现', '已下线'] as const

/** Convert a thrown value into a model-actionable tool argument error. */
export function fail(error: unknown): never {
  if (error instanceof DomainError) throw new ToolArgsError([`${error.code}: ${error.message}`])
  if (error instanceof Error) throw new ToolArgsError([error.message])
  throw new ToolArgsError([String(error)])
}

/** Present-call card used by every task tool. */
export function card(
  title: string,
  rawInput: unknown,
): {
  card: 'generic'
  title: string
  kind: 'other'
  rawInput: unknown
} {
  return { card: 'generic', title, kind: 'other', rawInput }
}
