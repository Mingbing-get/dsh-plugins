import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { ToolArgsError } from '@deepseek-ai/dsh-tools'
import { apply } from './index.ts'

describe('drawing server tools', () => {
  it('registers validation-only tools and treats valid calls as successful', async () => {
    const registered = new Map<string, ToolDefinition>()
    const contexts: { name: string; order: number; text: string }[] = []
    const ctx = {
      tools: {
        register(tool: ToolDefinition) {
          registered.set(tool.name, tool)
          return () => {}
        },
      },
      systemPrompt: {
        context(context: { name: string; order: number; text: string }) {
          contexts.push(context)
          return () => {}
        },
      },
    } as unknown as Context
    apply(ctx)

    expect([...registered.keys()]).toEqual([
      'create_image',
      'query_image',
      'edit_image',
      'undo_image',
      'redo_image',
    ])
    expect(contexts).toEqual([
      expect.objectContaining({
        name: 'drawing:edit-image-ops',
        order: 100,
        text: expect.stringContaining('# edit_image operation manual'),
      }),
    ])
    expect(contexts[0]!.text).toContain('## Examples')
    expect(contexts[0]!.text).toContain('{ op: "brush", points, color, radius?, opacity? }')

    const exec = { signal: new AbortController().signal } as ToolRunContext
    await expect(
      registered.get('edit_image')!.execute(
        {
          expectedVersion: 0,
          selection: { type: 'all' },
          ops: [{ op: 'fill', color: '#123456' }],
        },
        exec,
      ),
    ).resolves.toEqual({ ok: true })
  })

  it('returns validation failures as tool argument errors', async () => {
    const registered = new Map<string, ToolDefinition>()
    const ctx = {
      tools: {
        register(tool: ToolDefinition) {
          registered.set(tool.name, tool)
          return () => {}
        },
      },
      systemPrompt: {
        context() {
          return () => {}
        },
      },
    } as unknown as Context
    apply(ctx)

    const exec = { signal: new AbortController().signal } as ToolRunContext
    await expect(
      registered.get('query_image')!.execute({ scope: 'region' }, exec),
    ).rejects.toBeInstanceOf(ToolArgsError)
  })
})
