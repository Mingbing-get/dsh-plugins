/**
 * Intervention-panel wire contract, shared by the host and the browser halves.
 *
 * Deliberately dependency-free (no `node:` imports) so the client bundle can
 * import it. Two transports exist because DSH releases differ:
 *
 * - `channel`: an RPC channel owned by this plugin (`rpc.handle`). Preferred,
 *   and the only option on DSH builds that route a channel through the calling
 *   fiber.
 * - `fetch`: exact Fetch routes claimed under the shared `/api` channel, which
 *   is how DSH 0.1.5-rc.1 exposes plugin HTTP endpoints (its `rpc.handle`
 *   registers the physical route through the *connection* plugin's own context,
 *   which cannot read `webServer`, so a plugin channel can never mount there).
 *
 * Both sit behind the same `/api` authentication fence.
 */

/** RPC channel owned by this plugin (envelope transport). */
export const PANEL_CHANNEL = '/task-orchestrator'

/** Path prefix of the exact Fetch routes (raw transport). */
export const PANEL_FETCH_PREFIX = '/api/task-orchestrator'

/** Endpoints the panel exposes. */
export const PANEL_ENDPOINTS = ['snapshot', 'read', 'dismiss', 'retry', 'skip'] as const

/** One panel endpoint name. */
export type PanelEndpoint = (typeof PANEL_ENDPOINTS)[number]

/** Transport-neutral reply of one panel call. */
export type PanelOutcome = { ok: true; value: unknown } | { ok: false; error: string }

/** One panel call. */
export interface PanelRequest {
  endpoint: PanelEndpoint
  payload: unknown
}

/** Path of one exact Fetch route. */
export function panelFetchPath(endpoint: PanelEndpoint): string {
  return `${PANEL_FETCH_PREFIX}/${endpoint}`
}

/** Whether an untrusted value names a panel endpoint. */
export function isPanelEndpoint(value: unknown): value is PanelEndpoint {
  return typeof value === 'string' && (PANEL_ENDPOINTS as readonly string[]).includes(value)
}

/** One notification rendered by the panel. */
export interface PanelNotification {
  id: number
  /** Workspace root that owns this notification. */
  workspace: string
  /** Short label (basename) of that workspace. */
  workspaceLabel: string
  taskId: string | null
  kind: string
  title: string
  message: string
  createdAt: string
  readAt: string | null
}

/** One task summary rendered by the panel. */
export interface PanelTask {
  workspace: string
  taskId: string
  title: string
  status: string
  statusLabel: string
  attempt: number
  blockedReason: string | null
  documentPath: string
  dependsOn: string[]
}

/** Full panel snapshot across the workspaces this process serves. */
export interface PanelSnapshot {
  unread: number
  counts: Record<string, number>
  workspaces: { root: string; label: string; counts: Record<string, number> }[]
  notifications: PanelNotification[]
  tasks: PanelTask[]
  /** Feature digest of the only served workspace; empty when several are open. */
  featuresDigest: string
}
