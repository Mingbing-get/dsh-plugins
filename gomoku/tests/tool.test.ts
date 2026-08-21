import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions'
import { apply } from '../src/index.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('Gomoku tools', () => {
  it('keeps gomoku_start pending until the user places a stone', async () => {
    const answer = deferred<AskUserQuestionAnswer>()
    const ask = vi.fn(() => answer.promise)
    const registered = new Map<string, ToolDefinition>()
    const ctx = {
      tools: {
        register(tool: ToolDefinition) {
          registered.set(tool.name, tool)
          return () => {}
        },
      },
      userQuestions: { ask },
    } as unknown as Context
    apply(ctx)

    const session = {}
    const exec = {
      agent: { session },
      signal: new AbortController().signal,
    } as unknown as ToolRunContext
    const call = registered.get('gomoku_start')!.execute({}, exec)
    let settled = false
    void call.then(() => {
      settled = true
    })
    await Promise.resolve()

    expect(settled).toBe(false)
    expect(ask).toHaveBeenCalledOnce()
    const request = ask.mock.calls[0]![0]
    expect(request.questions[0]?.header).toBe('gomoku')

    answer.resolve({
      answers: [{ id: 'gomoku-move', selected: [], custom: JSON.stringify({ row: 8, column: 8 }) }],
    })
    const value = (await call) as {
      user_move: { row: number; column: number }
      game: { next: string }
    }
    expect(value.user_move).toEqual({ row: 8, column: 8 })
    expect(value.game.next).toBe('model')
  })
})
