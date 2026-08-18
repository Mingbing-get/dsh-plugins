import { useEffect, useMemo } from 'react'
import type { PendingWait, ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { SerializableGame } from '../game.ts'
import { GomokuWindow } from './GomokuWindow.tsx'
import type { GomokuStore } from './store.ts'

export type GomokuWait = PendingWait<'question'>
type GomokuToolRowProps = ToolCallViewProps & PropsStore<GomokuStore>

interface ToolValue {
  game: SerializableGame
  status: 'playing' | 'user_won' | 'model_won' | 'draw' | 'cancelled'
}

function gameOf(wait: GomokuWait): SerializableGame | null {
  const question = wait.payload.questions[0]
  if (question?.header !== 'gomoku' || question.detail === undefined) return null
  try {
    return JSON.parse(question.detail) as SerializableGame
  } catch {
    return null
  }
}

function resultOf(block: ToolCallBlock): ToolValue | null {
  if (!('kind' in block)) return null
  const text = block.content.filter(item => item.type === 'text').map(item => item.text).join('')
  try {
    const parsed = JSON.parse(text) as ToolValue
    return typeof parsed === 'object' && parsed !== null && parsed.game !== undefined ? parsed : null
  } catch {
    return null
  }
}

function terminal(status: ToolValue['status']): boolean {
  return status !== 'playing'
}

function statusText(block: ToolCallBlock, value: ToolValue | null): string {
  if (!('kind' in block)) return '等待你的落子'
  if (block.isError) return '调用失败'
  switch (value?.status) {
    case 'user_won': return '你已获胜'
    case 'model_won': return '模型获胜'
    case 'draw': return '和棋'
    case 'cancelled': return '本局已结束'
    default: return '已记录棋盘'
  }
}

export function GomokuToolRow({ callId, toolName, block, useSession, useStore, actions }: GomokuToolRowProps) {
  const wait = useSession(snapshot => snapshot.pending.find((item): item is GomokuWait =>
    item.kind === 'question' && item.payload.questions[0]?.header === 'gomoku') ?? null)
  const pendingGame = useMemo(() => wait === null ? null : gameOf(wait), [wait])
  const value = useMemo(() => resultOf(block), [block])
  const game = useStore(state => state.game)
  const open = useStore(state => state.open)
  const owner = useStore(state => state.ownerCallId === callId)
  const awaitingUser = useStore(state => state.awaitingUser)
  const x = useStore(state => state.x)
  const y = useStore(state => state.y)

  useEffect(() => {
    if ('kind' in block || wait === null || pendingGame === null) return
    actions.syncPending(pendingGame, callId, wait.key)
  }, [actions, block, callId, pendingGame, wait])

  useEffect(() => {
    if (value === null) return
    actions.syncSettled(value.game, callId, terminal(value.status), toolName === 'gomoku_start')
  }, [actions, callId, toolName, value])

  return (
    <>
      <div className="dsh-gomoku-tool-row">
        <span className="dsh-gomoku-tool-mark" aria-hidden />
        <span className="dsh-gomoku-tool-title">{toolName === 'gomoku_start' ? '开始五子棋' : '五子棋落子'}</span>
        <span className="dsh-gomoku-tool-status">{statusText(block, value)}</span>
        <button className="dsh-gomoku-show" type="button" disabled={game === null} onClick={() => { actions.reveal() }}>
          {open ? '棋盘已显示' : '显示棋盘'}
        </button>
      </div>
      {owner && open && game !== null && (
        <GomokuWindow
          game={game}
          wait={!('kind' in block) ? wait : null}
          awaitingUser={awaitingUser}
          x={x}
          y={y}
          actions={actions}
        />
      )}
    </>
  )
}
