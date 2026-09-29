/**
 * Browser-side transport for the intervention panel.
 *
 * The panel pulls a snapshot on mount and keeps it fresh with a short poll
 * (which also recovers the state after a page refresh or reconnect).
 *
 * Two host transports exist across DSH builds — a plugin-owned RPC channel and
 * exact Fetch routes under `/api` — so the client probes once and remembers
 * which one answered. Both sit behind the same authentication fence, and the
 * raw path sends the same bearer token the rest of the app uses.
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { PANEL_CHANNEL, panelFetchPath } from '../shared/panel-protocol.ts'
import type { PanelEndpoint, PanelOutcome, PanelSnapshot } from '../shared/panel-protocol.ts'

export type {
  PanelEndpoint,
  PanelNotification,
  PanelSnapshot,
  PanelTask,
} from '../shared/panel-protocol.ts'
export { PANEL_CHANNEL } from '../shared/panel-protocol.ts'

let current: ConnectionHandle | undefined
let transport: 'fetch' | 'channel' | undefined

/** Bind the live connection handle (called once from the client plugin body). */
export function setPanelConnection(connection: ConnectionHandle): void {
  current = connection
}

/** One panel call's outcome. */
export interface CallOutcome<T> {
  ok: boolean
  value?: T
  error?: string
}

/** Access-token provider installed by the host page (mirrors the app's client). */
async function accessToken(): Promise<string | undefined> {
  const provider = (globalThis as { __DSH_ACCESS_TOKEN__?: unknown }).__DSH_ACCESS_TOKEN__
  if (typeof provider !== 'function') return undefined
  const value = await (
    provider as () => string | null | undefined | Promise<string | null | undefined>
  )()
  return value === null || value === undefined || value === '' ? undefined : value
}

/** Remote base used by non-page carriers; empty means same-origin. */
function remoteBase(): string {
  const base = (globalThis as { __DSH_REMOTE_BASE__?: unknown }).__DSH_REMOTE_BASE__
  return typeof base === 'string' ? base : ''
}

/**
 * Call one endpoint over the raw Fetch route.
 * @returns the outcome, or `undefined` when the route is not mounted (404).
 */
async function callFetch(
  endpoint: PanelEndpoint,
  payload: unknown,
): Promise<PanelOutcome | undefined> {
  const token = await accessToken()
  const response = await fetch(`${remoteBase()}${panelFetchPath(endpoint)}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(payload ?? {}),
  })
  if (response.status === 404) return undefined
  if (!response.ok) {
    return { ok: false, error: `面板请求失败：HTTP ${String(response.status)}` }
  }
  return (await response.json()) as PanelOutcome
}

/** Call one endpoint over the plugin-owned RPC channel. */
async function callChannel(endpoint: PanelEndpoint, payload: unknown): Promise<PanelOutcome> {
  if (current === undefined) return { ok: false, error: '尚未连接 Host' }
  try {
    const result = await current.rpc.call(PANEL_CHANNEL, endpoint, payload, undefined)
    if (result.ok) return { ok: true, value: result.value }
    return { ok: false, error: result.error.message }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function call<T>(endpoint: PanelEndpoint, payload: unknown): Promise<CallOutcome<T>> {
  if (transport !== 'channel') {
    try {
      const outcome = await callFetch(endpoint, payload)
      if (outcome !== undefined) {
        transport = 'fetch'
        return outcome.ok
          ? { ok: true, value: outcome.value as T }
          : { ok: false, error: outcome.error }
      }
      transport = 'channel'
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
  const outcome = await callChannel(endpoint, payload)
  return outcome.ok ? { ok: true, value: outcome.value as T } : { ok: false, error: outcome.error }
}

/** Read the current snapshot. */
export function fetchSnapshot(): Promise<CallOutcome<PanelSnapshot>> {
  return call<PanelSnapshot>('snapshot', {})
}

/** Re-queue a failed or blocked task. */
export function retryTask(
  workspace: string,
  taskId: string,
  reason: string,
): Promise<CallOutcome<unknown>> {
  return call<unknown>('retry', { workspace, taskId, reason })
}

/** Skip a task and release its downstream tasks. */
export function skipTask(
  workspace: string,
  taskId: string,
  reason: string,
): Promise<CallOutcome<unknown>> {
  return call<unknown>('skip', { workspace, taskId, reason })
}

/** Dismiss one notification. */
export function dismissNotification(
  workspace: string,
  notificationId: number,
): Promise<CallOutcome<unknown>> {
  return call<unknown>('dismiss', { workspace, notificationId })
}

/** Which transport the panel settled on (diagnostics and tests). */
export function panelTransport(): 'fetch' | 'channel' | undefined {
  return transport
}
