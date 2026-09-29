/**
 * Floating intervention panel.
 *
 * Collapsed to a corner badge by default; expands into a draggable list of
 * failures and blocks with retry / skip / dismiss actions. It only ever reads
 * the host snapshot and posts the three actions back.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { dismissNotification, fetchSnapshot, retryTask, skipTask } from './panel-api.ts'
import type { PanelSnapshot } from './panel-api.ts'

const POLL_INTERVAL_MS = 4000

interface Offset {
  x: number
  y: number
}

function relativeTime(iso: string): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return iso
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (seconds < 60) return `${String(seconds)} 秒前`
  if (seconds < 3600) return `${String(Math.round(seconds / 60))} 分钟前`
  if (seconds < 86_400) return `${String(Math.round(seconds / 3600))} 小时前`
  return `${String(Math.round(seconds / 86_400))} 天前`
}

function itemClass(kind: string): string {
  if (kind === 'failed') return 'dsh-task-item dsh-task-failed'
  if (kind === 'blocked') return 'dsh-task-item dsh-task-blocked'
  return 'dsh-task-item'
}

/** The panel entry registered into the shell overlay slot. */
export function TaskPanel() {
  const [snapshot, setSnapshot] = useState<PanelSnapshot | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null)

  const refresh = useCallback(async () => {
    const outcome = await fetchSnapshot()
    if (outcome.ok && outcome.value !== undefined) {
      setSnapshot(outcome.value)
      setError(null)
    } else {
      setError(outcome.error ?? '无法读取任务状态')
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const act = useCallback(
    async (action: () => Promise<{ ok: boolean; error?: string }>) => {
      setBusy(true)
      const outcome = await action()
      if (!outcome.ok) setError(outcome.error ?? '操作失败')
      await refresh()
      setBusy(false)
    },
    [refresh],
  )

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      drag.current = { x: event.clientX, y: event.clientY, originX: offset.x, originY: offset.y }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [offset.x, offset.y],
  )

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (state === null) return
    setOffset({
      x: state.originX + (event.clientX - state.x),
      y: state.originY + (event.clientY - state.y),
    })
  }, [])

  const onPointerUp = useCallback(() => {
    drag.current = null
  }, [])

  const notifications = snapshot?.notifications ?? []
  const unread = snapshot?.unread ?? 0
  const counts = snapshot?.counts ?? {}
  const workspaces = snapshot?.workspaces ?? []
  const multiple = workspaces.length > 1

  return (
    <div
      className="dsh-task-panel"
      style={{ transform: `translate(${String(offset.x)}px, ${String(offset.y)}px)` }}
    >
      {open && (
        <section className="dsh-task-card" aria-label="任务编排面板">
          <header
            className="dsh-task-card-head"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <span className="dsh-task-card-title">任务编排</span>
            <span className="dsh-task-card-sub">
              待执行 {counts['pending'] ?? 0}｜执行中 {counts['running'] ?? 0}｜完成{' '}
              {counts['done'] ?? 0}
            </span>
            <button
              className="dsh-task-icon"
              type="button"
              title="立即刷新"
              onClick={() => void refresh()}
            >
              ⟳
            </button>
            <button
              className="dsh-task-icon"
              type="button"
              title="收起"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </header>
          <div className="dsh-task-body">
            {error !== null && <p className="dsh-task-error">{error}</p>}
            {multiple && (
              <p className="dsh-task-empty">
                正在服务 {workspaces.length} 个工作区：
                {workspaces.map((item) => item.label).join('、')}
              </p>
            )}
            <div className="dsh-task-summary">
              <span className="dsh-task-chip">
                失败 <b>{counts['failed'] ?? 0}</b>
              </span>
              <span className="dsh-task-chip">
                阻塞 <b>{counts['blocked'] ?? 0}</b>
              </span>
              <span className="dsh-task-chip">
                已取消 <b>{counts['cancelled'] ?? 0}</b>
              </span>
            </div>
            {notifications.length === 0 ? (
              <p className="dsh-task-empty">
                当前没有需要人工介入的任务。任务会在依赖满足后自动执行，每个任务一次独立提交。
              </p>
            ) : (
              notifications.map((item) => (
                <article key={item.id} className={itemClass(item.kind)}>
                  <div className="dsh-task-item-head">
                    <span className="dsh-task-item-title">{item.title}</span>
                    <span className="dsh-task-item-time">{relativeTime(item.createdAt)}</span>
                  </div>
                  {multiple && <p className="dsh-task-item-where">{item.workspaceLabel}</p>}
                  <p className="dsh-task-item-message">{item.message}</p>
                  <div className="dsh-task-item-actions">
                    {item.taskId !== null && (
                      <>
                        <button
                          className="dsh-task-action"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void act(() =>
                              retryTask(item.workspace, item.taskId as string, '面板人工重试'),
                            )
                          }
                        >
                          重试
                        </button>
                        <button
                          className="dsh-task-action dsh-task-action-danger"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void act(() =>
                              skipTask(item.workspace, item.taskId as string, '面板人工跳过'),
                            )
                          }
                        >
                          跳过
                        </button>
                      </>
                    )}
                    <button
                      className="dsh-task-action"
                      type="button"
                      disabled={busy}
                      onClick={() => void act(() => dismissNotification(item.workspace, item.id))}
                    >
                      忽略
                    </button>
                  </div>
                </article>
              ))
            )}
            {snapshot !== null && snapshot.featuresDigest.length > 0 && (
              <div className="dsh-task-features">{snapshot.featuresDigest}</div>
            )}
          </div>
        </section>
      )}
      <button
        className={`dsh-task-badge${unread > 0 ? ' dsh-task-alert' : ''}`}
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={open ? '收起任务编排面板' : '展开任务编排面板'}
      >
        任务编排
        {unread > 0 && <span className="dsh-task-count">{unread}</span>}
      </button>
    </div>
  )
}
