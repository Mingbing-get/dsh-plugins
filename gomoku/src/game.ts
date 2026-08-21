export type Player = 'user' | 'model'
export type Cell = Player | null

export interface Move {
  row: number
  column: number
  player: Player
}

export interface Game {
  id: string
  size: number
  board: Cell[][]
  userStone: 'black' | 'white'
  next: Player | null
  winner: Player | null
  moves: number
  lastMove: Move | null
}

export interface SerializableGame {
  id: string
  size: number
  board: string[]
  userStone: 'black' | 'white'
  next: Player | null
  winner: Player | null
  moves: number
  lastMove: Move | null
}

export const MIN_SIZE = 9
export const MAX_SIZE = 25

export function createGame(size: number, modelFirst: boolean): Game {
  if (!Number.isInteger(size) || size < MIN_SIZE || size > MAX_SIZE) {
    throw new Error(`size must be an integer from ${MIN_SIZE} to ${MAX_SIZE}`)
  }
  return {
    id: crypto.randomUUID(),
    size,
    board: Array.from({ length: size }, () => Array<Cell>(size).fill(null)),
    userStone: modelFirst ? 'white' : 'black',
    next: modelFirst ? 'model' : 'user',
    winner: null,
    moves: 0,
    lastMove: null,
  }
}

function lineLength(
  game: Game,
  row: number,
  column: number,
  player: Player,
  dr: number,
  dc: number,
): number {
  let count = 1
  for (const sign of [-1, 1]) {
    let r = row + dr * sign
    let c = column + dc * sign
    while (r >= 0 && r < game.size && c >= 0 && c < game.size && game.board[r]?.[c] === player) {
      count++
      r += dr * sign
      c += dc * sign
    }
  }
  return count
}

export function place(game: Game, move: Move): void {
  if (game.winner !== null) throw new Error('the game is already over')
  if (game.next !== move.player) throw new Error(`it is ${game.next ?? 'nobody'}'s turn`)
  const row = move.row - 1
  const column = move.column - 1
  if (row < 0 || row >= game.size || column < 0 || column >= game.size) {
    throw new Error(`row and column must be from 1 to ${game.size}`)
  }
  if (game.board[row]?.[column] !== null)
    throw new Error(`cell ${move.row},${move.column} is occupied`)
  game.board[row]![column] = move.player
  game.moves++
  game.lastMove = { ...move }
  const won = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ].some(([dr, dc]) => lineLength(game, row, column, move.player, dr!, dc!) >= 5)
  if (won) {
    game.winner = move.player
    game.next = null
  } else if (game.moves === game.size * game.size) {
    game.next = null
  } else {
    game.next = move.player === 'user' ? 'model' : 'user'
  }
}

export function serializeGame(game: Game): SerializableGame {
  return {
    id: game.id,
    size: game.size,
    board: game.board.map((row) =>
      row.map((cell) => (cell === null ? '.' : cell === 'user' ? 'U' : 'M')).join(''),
    ),
    userStone: game.userStone,
    next: game.next,
    winner: game.winner,
    moves: game.moves,
    lastMove: game.lastMove === null ? null : { ...game.lastMove },
  }
}
