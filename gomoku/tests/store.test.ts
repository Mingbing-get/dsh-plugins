import { describe, expect, it } from 'vitest'
import { createGame, place, serializeGame } from '../src/game.ts'
import { createGomokuStore } from '../src/client/store.ts'

describe('Gomoku window store', () => {
  it('opens for a new pending move but respects a manual close for the same request', () => {
    const { actions, store } = createGomokuStore().create('session-a')
    const game = serializeGame(createGame(15, false))
    actions.syncPending(game, 'call-1', 'request-1')
    expect(store.getSnapshot().open).toBe(true)

    actions.close()
    actions.syncPending(game, 'call-1', 'request-1')
    expect(store.getSnapshot().open).toBe(false)

    actions.syncPending(game, 'call-2', 'request-2')
    expect(store.getSnapshot().open).toBe(true)
    expect(store.getSnapshot().ownerCallId).toBe('call-2')
  })

  it('keeps the window open after a user move and closes it when the game ends', () => {
    const { actions, store } = createGomokuStore().create('session-b')
    const game = createGame(15, false)
    actions.syncPending(serializeGame(game), 'call-1', 'request-1')
    actions.optimisticMove(8, 8)
    expect(store.getSnapshot()).toMatchObject({ open: true, awaitingUser: false })
    expect(store.getSnapshot().game?.board[7]?.[7]).toBe('U')

    place(game, { row: 8, column: 8, player: 'user' })
    actions.syncSettled(serializeGame(game), 'call-1', false, true)
    expect(store.getSnapshot().open).toBe(true)
    actions.syncSettled(serializeGame(game), 'call-1', true, false)
    expect(store.getSnapshot().open).toBe(false)
  })

  it('preserves a dragged position across later moves', () => {
    const { actions, store } = createGomokuStore().create('session-c')
    actions.moveWindow(120, 72)
    actions.syncPending(serializeGame(createGame(15, false)), 'call-1', 'request-1')
    expect(store.getSnapshot()).toMatchObject({ x: 120, y: 72 })
  })
})
