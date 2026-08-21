import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { ToolArgsError } from '@deepseek-ai/dsh-tools'
import { apply } from './index.ts'

describe('drawing server tools', () => {
  it('registers tools and treats valid edit calls as successful', async () => {
    const registered = new Map<string, ToolDefinition>()
    const contexts: { name: string; order: number; text: string }[] = []
    const ctx = {
      connection: { rpc: { handle: () => async () => {} } },
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

  it('returns metadata posted automatically by the drawing client', async () => {
    const registered = new Map<string, ToolDefinition>()
    let handler:
      ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>) | undefined
    const ctx = {
      connection: {
        rpc: {
          handle(_channel: string, next: typeof handler) {
            handler = next
            return async () => {}
          },
        },
      },
      tools: {
        register(tool: ToolDefinition) {
          registered.set(tool.name, tool)
          return () => {}
        },
      },
      systemPrompt: { context: () => () => {} },
    } as unknown as Context
    apply(ctx)

    const controller = new AbortController()
    const exec = {
      callId: 'drawing-query-image',
      agent: { id: 'drawing-session' },
      signal: controller.signal,
    } as ToolRunContext
    const result = {
      imageId: 'image:main',
      version: 3,
      width: 640,
      height: 480,
      selection: null,
      bounds: { x: 0, y: 0, w: 640, h: 480 },
      alpha: { opaque: 307200, transparent: 0, partial: 0 },
      clipped: false,
    }
    const pending = registered.get('query_image')!.execute({ scope: 'summary' }, exec)
    await handler!(
      'image-metadata',
      {
        sessionId: 'drawing-session',
        callId: 'drawing-query-image',
        result: { ok: true, value: result },
      },
      controller.signal,
    )
    await expect(pending).resolves.toEqual(result)
  })

  it('rejects a query when the drawing client cannot calculate image metadata', async () => {
    const registered = new Map<string, ToolDefinition>()
    let handler:
      ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>) | undefined
    const ctx = {
      connection: {
        rpc: {
          handle(_channel: string, next: typeof handler) {
            handler = next
            return async () => {}
          },
        },
      },
      tools: {
        register(tool: ToolDefinition) {
          registered.set(tool.name, tool)
          return () => {}
        },
      },
      systemPrompt: { context: () => () => {} },
    } as unknown as Context
    apply(ctx)

    const controller = new AbortController()
    const pending = registered.get('query_image')!.execute({ scope: 'summary' }, {
      callId: 'drawing-query-image-error',
      agent: { id: 'drawing-session' },
      signal: controller.signal,
    } as ToolRunContext)
    await handler!(
      'image-metadata',
      {
        sessionId: 'drawing-session',
        callId: 'drawing-query-image-error',
        result: { ok: false, error: 'no drawing image exists in this session' },
      },
      controller.signal,
    )
    await expect(pending).rejects.toThrow('no drawing image exists in this session')
  })

  it('returns validation failures as tool argument errors', async () => {
    const registered = new Map<string, ToolDefinition>()
    const ctx = {
      connection: { rpc: { handle: () => async () => {} } },
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
