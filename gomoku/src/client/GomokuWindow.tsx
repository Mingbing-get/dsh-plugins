import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { SerializableGame } from '../game.ts'
import type { GomokuStore } from './store.ts'
import type { GomokuWait } from './GomokuToolRow.tsx'

interface GomokuWindowProps {
  game: SerializableGame
  wait: GomokuWait | null
  x: number | null
  y: number | null
  awaitingUser: boolean
  actions: BoundActions<GomokuStore>
}

function stoneColor(game: SerializableGame, value: string): 'black' | 'white' | null {
  if (value === '.') return null
  if (value === 'U') return game.userStone
  return game.userStone === 'black' ? 'white' : 'black'
}

function turnLabel(game: SerializableGame, wait: GomokuWait | null, awaitingUser: boolean): string {
  if (game.winner === 'user') return '你已获胜'
  if (game.winner === 'model') return '模型获胜'
  if (game.next === null) return '本局结束'
  if (wait !== null && awaitingUser) return '轮到你落子'
  return '等待模型落子'
}

export function GomokuWindow({ game, wait, x, y, awaitingUser, actions }: GomokuWindowProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const drag = useRef<{
    pointerId: number
    dx: number
    dy: number
    width: number
    height: number
  } | null>(null)
  const frame = useRef<number | null>(null)
  const latest = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (wait === null) setPending(false)
  }, [wait])

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    [],
  )

  const cellSize = game.size > 19 ? 20 : game.size > 15 ? 23 : 27
  const style = {
    '--cell': `${cellSize}px`,
    ...(x === null || y === null ? {} : { left: x, top: y }),
  } as CSSProperties
  const boardStyle = { gridTemplateColumns: `repeat(${game.size}, var(--cell))` }

  const submit = async (row: number, column: number) => {
    if (pending || wait === null || !awaitingUser) return
    setPending(true)
    setError(null)
    actions.optimisticMove(row, column)
    try {
      const receipt = await wait.respond({
        ok: true,
        value: {
          sessionId: wait.sessionId,
          answer: {
            answers: [{ id: 'gomoku-move', selected: [], custom: JSON.stringify({ row, column }) }],
          },
        },
      })
      if (!receipt.accepted) throw new Error(`落子未被接受：${receipt.reason}`)
    } catch (cause) {
      actions.restoreAwaiting()
      setPending(false)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button') !== null) return
    const rect = event.currentTarget.parentElement!.getBoundingClientRect()
    drag.current = {
      pointerId: event.pointerId,
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const active = drag.current
    if (active === null || active.pointerId !== event.pointerId) return
    const next = {
      x: Math.max(8, Math.min(window.innerWidth - active.width - 8, event.clientX - active.dx)),
      y: Math.max(8, Math.min(window.innerHeight - active.height - 8, event.clientY - active.dy)),
    }
    latest.current = next
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      if (latest.current !== null) actions.moveWindow(latest.current.x, latest.current.y)
    })
  }

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <section
      className="dsh-gomoku-window"
      data-centered={x === null || y === null || undefined}
      role="dialog"
      aria-label="五子棋棋盘"
      style={style}
    >
      <header
        className="dsh-gomoku-header"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div>
          <p className="dsh-gomoku-kicker">DeepSeek 对弈室</p>
          <h2 className="dsh-gomoku-title">五子棋</h2>
          <p className="dsh-gomoku-meta">
            {game.size} × {game.size} · 你执{game.userStone === 'black' ? '黑子' : '白子'} ·
            拖动标题栏移动
          </p>
        </div>
        <div className="dsh-gomoku-header-actions">
          <div className="dsh-gomoku-turn">
            {pending ? '落子确认中' : turnLabel(game, wait, awaitingUser)}
          </div>
          <button
            className="dsh-gomoku-close"
            type="button"
            aria-label="关闭棋盘"
            onClick={() => {
              actions.close()
            }}
          >
            ×
          </button>
        </div>
      </header>
      <div className="dsh-gomoku-body">
        <div className="dsh-gomoku-board-wrap">
          <div
            className="dsh-gomoku-board"
            role="grid"
            aria-label={`${game.size}乘${game.size}五子棋棋盘`}
            style={boardStyle}
          >
            {game.board.flatMap((line, row) =>
              [...line].map((value, column) => {
                const color = stoneColor(game, value)
                const last = game.lastMove?.row === row + 1 && game.lastMove.column === column + 1
                const playable = wait !== null && awaitingUser && !pending && value === '.'
                return (
                  <button
                    className="dsh-gomoku-cell"
                    type="button"
                    role="gridcell"
                    key={`${row}:${column}`}
                    disabled={!playable}
                    aria-label={`第${row + 1}行，第${column + 1}列${color === null ? '空位' : color === 'black' ? '黑子' : '白子'}`}
                    onClick={() => {
                      void submit(row + 1, column + 1)
                    }}
                  >
                    {color !== null && (
                      <span
                        className="dsh-gomoku-stone"
                        data-color={color}
                        data-last={last || undefined}
                      />
                    )}
                  </button>
                )
              }),
            )}
          </div>
        </div>
      </div>
      <footer className="dsh-gomoku-footer">
        <span className={error === null ? undefined : 'dsh-gomoku-error'}>
          {error ??
            (wait !== null && awaitingUser
              ? '点击交叉点落子；窗口会保留，等待模型应手。'
              : '棋盘会保留在这里；模型下一手到达时会自动刷新并打开。')}
        </span>
      </footer>
    </section>
  )
}
