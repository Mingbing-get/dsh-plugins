import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-user-questions'
import {
  createGame,
  MAX_SIZE,
  MIN_SIZE,
  place,
  serializeGame,
  type Game,
  type Move,
} from './game.ts'

export const name = 'gomoku-game'
export const inject = ['tools', 'userQuestions']

const games = new WeakMap<object, Game>()

interface HumanChoice {
  row?: number
  column?: number
  cancelled?: true
}

interface InteractiveExecution {
  agent?: AskUserQuestionRequest['agent']
  signal: AbortSignal
}

function sessionOf(exec: InteractiveExecution): object {
  if (exec.agent === undefined) throw new Error('gomoku tools require an agent-owned session')
  return exec.agent.session
}

function answerChoice(answer: AskUserQuestionAnswer): HumanChoice {
  const raw = answer.answers.find((item) => item.id === 'gomoku-move')?.custom
  if (raw === undefined) throw new Error('the Gomoku interaction returned no move')
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('the Gomoku interaction returned malformed JSON')
  }
  if (typeof value !== 'object' || value === null)
    throw new Error('the Gomoku interaction returned an invalid move')
  const choice = value as HumanChoice
  if (choice.cancelled === true) return { cancelled: true }
  if (!Number.isInteger(choice.row) || !Number.isInteger(choice.column)) {
    throw new Error('the Gomoku interaction returned invalid coordinates')
  }
  return { row: choice.row as number, column: choice.column as number }
}

async function waitForUser(
  ctx: Context,
  game: Game,
  exec: InteractiveExecution,
): Promise<Move | null> {
  const answer = await ctx.userQuestions.ask({
    questions: [
      {
        id: 'gomoku-move',
        header: 'gomoku',
        question: game.userStone === 'black' ? '你执黑，请落子' : '你执白，请落子',
        detail: JSON.stringify(serializeGame(game)),
      },
    ],
    ...(exec.agent === undefined ? {} : { agent: exec.agent }),
    signal: exec.signal,
  })
  const choice = answerChoice(answer)
  if (choice.cancelled === true) {
    game.next = null
    return null
  }
  const move: Move = { row: choice.row!, column: choice.column!, player: 'user' }
  place(game, move)
  return move
}

function statusOf(
  game: Game,
  cancelled: boolean,
): 'playing' | 'user_won' | 'model_won' | 'draw' | 'cancelled' {
  if (cancelled) return 'cancelled'
  if (game.winner === 'user') return 'user_won'
  if (game.winner === 'model') return 'model_won'
  if (game.next === null) return 'draw'
  return 'playing'
}

function result(game: Game, userMove: Move | null, cancelled = false) {
  return {
    game: serializeGame(game),
    user_move: userMove === null ? null : { row: userMove.row, column: userMove.column },
    status: statusOf(game, cancelled),
  }
}

const output = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      game: {
        type: 'object',
        required: true,
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          size: { type: 'integer', required: true },
          board: { type: 'array', required: true, items: { type: 'string' } },
          userStone: { type: 'string', required: true, enum: ['black', 'white'] },
          next: {
            required: true,
            oneOf: [{ type: 'string', enum: ['user', 'model'] }, { type: 'null' }],
          },
          winner: {
            required: true,
            oneOf: [{ type: 'string', enum: ['user', 'model'] }, { type: 'null' }],
          },
          moves: { type: 'integer', required: true },
          lastMove: {
            required: true,
            oneOf: [
              {
                type: 'object',
                additionalProperties: false,
                properties: {
                  row: { type: 'integer', required: true },
                  column: { type: 'integer', required: true },
                  player: { type: 'string', required: true, enum: ['user', 'model'] },
                },
              },
              { type: 'null' },
            ],
          },
        },
      },
      user_move: {
        required: true,
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              row: { type: 'integer', required: true },
              column: { type: 'integer', required: true },
            },
          },
          { type: 'null' },
        ],
      },
      status: {
        type: 'string',
        required: true,
        enum: ['playing', 'user_won', 'model_won', 'draw', 'cancelled'],
      },
    },
  },
  render: (_args: unknown, value: unknown) => [
    { type: 'text' as const, text: JSON.stringify(value) },
  ],
} as const

export function apply(ctx: Context): void {
  ctx.tools.register(
    defineTool({
      name: 'gomoku_start',
      description:
        '当用户想下五子棋时立即调用。默认创建 15×15 棋盘且用户先手。本工具会打开棋盘并一直等待用户点击落子，用户落子后才返回。若 model_first=true，请同时用 first_move_row/first_move_column 给出你分析后选择的第一手；省略时落在中心。',
      parameters: {
        size: { type: 'integer', description: `棋盘边长，${MIN_SIZE} 到 ${MAX_SIZE}；省略为 15。` },
        model_first: { type: 'boolean', description: '模型是否先手；省略为 false。' },
        first_move_row: { type: 'integer', description: '模型先手时的第一手行号，从 1 开始。' },
        first_move_column: { type: 'integer', description: '模型先手时的第一手列号，从 1 开始。' },
      },
      output,
      async execute(args, exec) {
        const size = args.size ?? 15
        const modelFirst = args.model_first ?? false
        const game = createGame(size, modelFirst)
        if (modelFirst) {
          place(game, {
            row: args.first_move_row ?? Math.ceil(size / 2),
            column: args.first_move_column ?? Math.ceil(size / 2),
            player: 'model',
          })
        }
        games.set(sessionOf(exec), game)
        const userMove = await waitForUser(ctx, game, exec)
        return result(game, userMove, userMove === null)
      },
      presentCall: (args) => ({
        card: 'generic',
        title: '开始五子棋',
        kind: 'other',
        rawInput: args,
      }),
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'gomoku_move',
      description:
        '根据棋盘与用户上一手进行分析后，用本工具下模型的一手。工具落下模型棋子，若未结束就打开棋盘并等待用户下一手；只有用户完成落子后才返回。row/column 是模型选择的坐标，不是用户坐标。',
      parameters: {
        row: { type: 'integer', required: true, description: '模型落子的行号，从 1 开始。' },
        column: { type: 'integer', required: true, description: '模型落子的列号，从 1 开始。' },
      },
      output,
      async execute(args, exec) {
        const game = games.get(sessionOf(exec))
        if (game === undefined) throw new Error('no Gomoku game is active; call gomoku_start first')
        place(game, { row: args.row, column: args.column, player: 'model' })
        if (game.winner !== null || game.next === null) return result(game, null)
        const userMove = await waitForUser(ctx, game, exec)
        return result(game, userMove, userMove === null)
      },
      presentCall: (args) => ({
        card: 'generic',
        title: '五子棋落子',
        kind: 'other',
        rawInput: args,
      }),
    }),
  )
}
