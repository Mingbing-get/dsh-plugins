import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { ToolArgsError } from '@deepseek-ai/dsh-tools'
import { apply } from './index.ts'

describe('drawing server tools', () => {
  it('registers tools and treats valid edit calls as successful', async () => {
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

  it('requests live drawing metadata from the client before returning query_image results', async () => {
    const ask = vi.fn().mockResolvedValue({
      answers: [
        {
          id: 'drawing-query-image',
          selected: [],
          custom: JSON.stringify({
            ok: true,
            value: {
              imageId: 'image:main',
              version: 3,
              width: 640,
              height: 480,
              selection: null,
              bounds: { x: 0, y: 0, w: 640, h: 480 },
              alpha: { opaque: 307200, transparent: 0, partial: 0 },
              clipped: false,
            },
          }),
        },
      ],
    })
    const registered = new Map<string, ToolDefinition>()
    const ctx = {
      tools: {
        register(tool: ToolDefinition) {
          registered.set(tool.name, tool)
          return () => {}
        },
      },
      systemPrompt: { context: () => () => {} },
      userQuestions: { ask },
    } as unknown as Context
    apply(ctx)

    const exec = { signal: new AbortController().signal } as ToolRunContext
    await expect(
      registered.get('query_image')!.execute({ scope: 'summary' }, exec),
    ).resolves.toEqual({
      imageId: 'image:main',
      version: 3,
      width: 640,
      height: 480,
      selection: null,
      bounds: { x: 0, y: 0, w: 640, h: 480 },
      alpha: { opaque: 307200, transparent: 0, partial: 0 },
      clipped: false,
    })
    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({
        questions: [
          expect.objectContaining({
            id: 'drawing-query-image',
            header: 'drawing:query-image',
            detail: JSON.stringify({ scope: 'summary' }),
          }),
        ],
        signal: exec.signal,
      }),
    )
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
