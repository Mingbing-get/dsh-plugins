import { describe, expect, it } from 'vitest'
import { createGame, place, serializeGame } from '../src/game.ts'

describe('Gomoku game', () => {
  it('starts with the configured first player and serializes the board', () => {
    const game = createGame(15, true)
    expect(game.next).toBe('model')
    expect(game.userStone).toBe('white')
    expect(game.id).toBeTypeOf('string')
    expect(serializeGame(game).board).toHaveLength(15)
  })

  it('alternates turns and detects five in a row', () => {
    const game = createGame(15, false)
    for (let column = 1; column <= 5; column++) {
      place(game, { row: 8, column, player: 'user' })
      if (column < 5) place(game, { row: 1, column, player: 'model' })
    }
    expect(game.winner).toBe('user')
    expect(game.next).toBeNull()
  })

  it('rejects occupied cells and out-of-turn moves', () => {
    const game = createGame(15, false)
    expect(() => place(game, { row: 8, column: 8, player: 'model' })).toThrow(/user's turn/)
    place(game, { row: 8, column: 8, player: 'user' })
    expect(() => place(game, { row: 8, column: 8, player: 'model' })).toThrow(/occupied/)
  })

  it('detects a diagonal model win', () => {
    const game = createGame(15, true)
    for (let point = 1; point <= 5; point++) {
      place(game, { row: point, column: point, player: 'model' })
      if (point < 5) place(game, { row: 15, column: point, player: 'user' })
    }
    expect(game.winner).toBe('model')
  })
})
