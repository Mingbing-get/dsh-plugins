import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { SerializableGame } from '../game.ts'

export interface GomokuWindowState {
  game: SerializableGame | null
  open: boolean
  ownerCallId: string | null
  requestKey: string | null
  awaitingUser: boolean
  x: number | null
  y: number | null
}

type GomokuWindowActions = {
  syncPending: (
    draft: GomokuWindowState,
    game: SerializableGame,
    callId: string,
    requestKey: string,
  ) => void
  syncSettled: (
    draft: GomokuWindowState,
    game: SerializableGame,
    callId: string,
    terminal: boolean,
    isStart: boolean,
  ) => void
  optimisticMove: (draft: GomokuWindowState, row: number, column: number) => void
  restoreAwaiting: (draft: GomokuWindowState) => void
  reveal: (draft: GomokuWindowState) => void
  close: (draft: GomokuWindowState) => void
  moveWindow: (draft: GomokuWindowState, x: number, y: number) => void
}

export type GomokuStore = EngineStoreHandle<GomokuWindowState, GomokuWindowActions>

function shouldReplace(
  current: SerializableGame | null,
  incoming: SerializableGame,
  isStart: boolean,
): boolean {
  if (current === null || current.id === incoming.id)
    return current === null || incoming.moves >= current.moves
  return isStart
}

export function createGomokuStore(): GomokuStore {
  return defineStore({
    init: (): GomokuWindowState => ({
      game: null,
      open: false,
      ownerCallId: null,
      requestKey: null,
      awaitingUser: false,
      x: null,
      y: null,
    }),
    actions: {
      syncPending(draft, game, callId, requestKey) {
        const isNewRequest = draft.requestKey !== requestKey
        draft.game = game
        draft.ownerCallId = callId
        draft.requestKey = requestKey
        draft.awaitingUser = true
        if (isNewRequest) draft.open = true
      },
      syncSettled(draft, game, callId, terminal, isStart) {
        if (!shouldReplace(draft.game, game, isStart)) return
        draft.game = game
        draft.ownerCallId = callId
        draft.awaitingUser = false
        if (terminal) draft.open = false
      },
      optimisticMove(draft, row, column) {
        const game = draft.game
        if (game === null) return
        const line = game.board[row - 1]
        if (line === undefined || line[column - 1] !== '.') return
        game.board[row - 1] = `${line.slice(0, column - 1)}U${line.slice(column)}`
        game.moves++
        game.lastMove = { row, column, player: 'user' }
        game.next = 'model'
        draft.awaitingUser = false
      },
      restoreAwaiting(draft) {
        draft.awaitingUser = true
      },
      reveal(draft) {
        if (draft.game !== null) draft.open = true
      },
      close(draft) {
        draft.open = false
      },
      moveWindow(draft, x, y) {
        draft.x = x
        draft.y = y
      },
    },
  })
}
