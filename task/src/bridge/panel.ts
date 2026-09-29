/**
 * Host half of the intervention panel.
 *
 * The panel is read-mostly and workspace-aware: a snapshot aggregates every
 * workspace this process currently serves, and each action names the workspace
 * it applies to (resolved by task id when the client does not say).
 *
 * The endpoint logic is transport-neutral ({@link createPanelHandler}); the
 * installer exposes it over whichever transport the running DSH build supports
 * — see `src/shared/panel-protocol.ts` for why there are two.
 */

import { basename } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { Workspace, WorkspaceRegistry } from '../workspace/registry.ts'
import type { OrchestratorLogger } from '../service.ts'
import { describeError } from '../domain/errors.ts'
import {
  PANEL_CHANNEL,
  PANEL_ENDPOINTS,
  isPanelEndpoint,
  panelFetchPath,
} from '../shared/panel-protocol.ts'
import type { PanelOutcome, PanelRequest, PanelSnapshot } from '../shared/panel-protocol.ts'

export { PANEL_CHANNEL, PANEL_FETCH_PREFIX, PANEL_ENDPOINTS } from '../shared/panel-protocol.ts'

const STATUS_LABEL: Record<string, string> = {
  pending: '待执行',
  running: '执行中',
  done: '已完成',
  failed: '失败',
  blocked: '阻塞',
  cancelled: '已取消',
}

const EMPTY_COUNTS: Record<string, number> = {
  pending: 0,
  running: 0,
  done: 0,
  failed: 0,
  blocked: 0,
  cancelled: 0,
}

function asRecord(payload: unknown): Record<string, unknown> | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null
  return payload as Record<string, unknown>
}

function label(root: string): string {
  return basename(root) || root
}

function mergeCounts(target: Record<string, number>, source: Record<string, number>): void {
  for (const [key, value] of Object.entries(source)) target[key] = (target[key] ?? 0) + value
}

/** Locate the workspace that owns the notification or task named in a payload. */
function locate(
  registry: WorkspaceRegistry,
  payload: Record<string, unknown> | null,
  kind: 'task' | 'notification',
): Workspace | undefined {
  const explicit = payload?.['workspace']
  if (typeof explicit === 'string' && explicit.length > 0) return registry.find(explicit)
  const taskId = payload?.['taskId']
  if (typeof taskId === 'string') {
    const owner = registry.list().find((workspace) => workspace.store.getTask(taskId) !== undefined)
    if (owner !== undefined) return owner
  }
  const notificationId = payload?.['notificationId']
  if (kind === 'notification' && typeof notificationId === 'number') {
    return registry
      .list()
      .find((workspace) =>
        workspace.store
          .listNotifications({ includeResolved: true })
          .some((item) => item.id === notificationId),
      )
  }
  return undefined
}

function snapshot(registry: WorkspaceRegistry): PanelSnapshot {
  const workspaces = registry.list()
  const counts = { ...EMPTY_COUNTS }
  const notifications: PanelSnapshot['notifications'] = []
  const tasks: PanelSnapshot['tasks'] = []
  const summaries: PanelSnapshot['workspaces'] = []
  let unread = 0
  for (const workspace of workspaces) {
    const workspaceCounts = workspace.store.countByStatus()
    mergeCounts(counts, workspaceCounts)
    unread += workspace.store.unreadCount()
    summaries.push({ root: workspace.root, label: label(workspace.root), counts: workspaceCounts })
    for (const item of workspace.store.listNotifications()) {
      notifications.push({
        id: item.id,
        workspace: workspace.root,
        workspaceLabel: label(workspace.root),
        taskId: item.taskId,
        kind: item.kind,
        title: item.title,
        message: item.message,
        createdAt: item.createdAt,
        readAt: item.readAt,
      })
    }
    for (const task of workspace.store.listTasks().slice(0, 50)) {
      tasks.push({
        workspace: workspace.root,
        taskId: task.id,
        title: task.title,
        status: task.status,
        statusLabel: STATUS_LABEL[task.status] ?? task.status,
        attempt: task.attempt,
        blockedReason: task.blockedReason,
        documentPath: task.documentPath,
        dependsOn: task.dependsOn,
      })
    }
  }
  const only = workspaces.length === 1 ? (workspaces[0] as Workspace) : undefined
  return {
    unread,
    counts,
    workspaces: summaries,
    notifications,
    tasks,
    featuresDigest: only === undefined ? '' : only.service.readFeatures().digest,
  }
}

function bad(error: string): PanelOutcome {
  return { ok: false, error }
}

/**
 * Build the transport-neutral endpoint handler.
 * @param registry - workspace registry serving the panel.
 * @returns the handler shared by every transport.
 */
export function createPanelHandler(
  registry: WorkspaceRegistry,
): (request: PanelRequest) => Promise<PanelOutcome> {
  return async ({ endpoint, payload }) => {
    const record = asRecord(payload)
    switch (endpoint) {
      case 'snapshot':
        return { ok: true, value: snapshot(registry) }
      case 'read': {
        const id = record?.['notificationId']
        if (typeof id !== 'number') return bad('read 需要 notificationId')
        const workspace = locate(registry, record, 'notification')
        if (workspace === undefined) return bad('找不到该通知所属的工作区')
        workspace.store.markNotificationRead(id)
        return { ok: true, value: { read: id, workspace: workspace.root } }
      }
      case 'dismiss': {
        const id = record?.['notificationId']
        if (typeof id !== 'number') return bad('dismiss 需要 notificationId')
        const workspace = locate(registry, record, 'notification')
        if (workspace === undefined) return bad('找不到该通知所属的工作区')
        workspace.store.resolveNotification(id)
        return { ok: true, value: { dismissed: id, workspace: workspace.root } }
      }
      case 'retry': {
        const taskId = record?.['taskId']
        if (typeof taskId !== 'string') return bad('retry 需要 taskId')
        const workspace = locate(registry, record, 'task')
        if (workspace === undefined) return bad(`找不到任务 ${taskId} 所属的工作区`)
        const reason = typeof record?.['reason'] === 'string' ? record['reason'] : '面板人工重试'
        return { ok: true, value: await workspace.service.retryTask(taskId, reason) }
      }
      case 'skip': {
        const taskId = record?.['taskId']
        if (typeof taskId !== 'string') return bad('skip 需要 taskId')
        const workspace = locate(registry, record, 'task')
        if (workspace === undefined) return bad(`找不到任务 ${taskId} 所属的工作区`)
        const reason = typeof record?.['reason'] === 'string' ? record['reason'] : '面板人工跳过'
        return { ok: true, value: await workspace.service.skipTask(taskId, reason) }
      }
      default:
        return bad(`未知端点：${endpoint}`)
    }
  }
}

/** Exact-Fetch-route registry present on DSH builds without a usable RPC channel. */
interface LegacyFetchRoutes {
  register(route: {
    path: string
    methods: string[]
    requestBody: 'buffered'
    fetch: (request: Request) => Promise<Response>
  }): unknown
}

/** Which transport the panel was mounted on. */
export type PanelTransport = 'channel' | 'fetch'

function reply(outcome: PanelOutcome): Response {
  return new Response(JSON.stringify(outcome), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

/**
 * Register the panel on whichever transport this DSH build supports.
 *
 * `rpc.handle` is attempted first; on builds that register the physical route
 * through the connection plugin's own context it throws, and the panel falls
 * back to exact Fetch routes under `/api` (both sit behind the same
 * authentication fence).
 * @param ctx - host plugin context (`connection` must be injected).
 * @param registry - workspace registry serving the panel.
 * @param logger - plugin logger.
 * @returns the transport that was mounted.
 */
export function installPanelBridge(
  ctx: Context,
  registry: WorkspaceRegistry,
  logger: OrchestratorLogger,
): PanelTransport {
  const handler = createPanelHandler(registry)
  try {
    ctx.connection.rpc.handle(
      PANEL_CHANNEL,
      async (endpoint, payload) => {
        if (!isPanelEndpoint(endpoint)) {
          return {
            ok: false as const,
            error: {
              code: 'bad-request' as const,
              message: `未知端点：${endpoint}`,
              details: { issues: [] },
            },
          }
        }
        try {
          const outcome = await handler({ endpoint, payload })
          if (outcome.ok) return { ok: true as const, value: outcome.value }
          return {
            ok: false as const,
            error: {
              code: 'bad-request' as const,
              message: outcome.error,
              details: { issues: [] },
            },
          }
        } catch (error) {
          logger.error(`task-orchestrator: 面板端点 ${endpoint} 失败：${describeError(error)}`)
          return {
            ok: false as const,
            error: { code: 'internal' as const, message: describeError(error), details: {} },
          }
        }
      },
      { authority: 'trusted-host' },
    )
    return 'channel'
  } catch (error) {
    logger.warn(
      `task-orchestrator: RPC 通道不可用（${describeError(error)}），改用 /api 精确 Fetch 路由`,
    )
  }

  const routes = (ctx.connection as unknown as { fetch?: LegacyFetchRoutes }).fetch
  if (routes === undefined) {
    throw new Error('当前 DSH 构建既没有可用的 RPC 通道，也没有精确 Fetch 路由，无法注册通知面板')
  }
  for (const endpoint of PANEL_ENDPOINTS) {
    routes.register({
      path: panelFetchPath(endpoint),
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request: Request): Promise<Response> => {
        let payload: unknown
        try {
          payload = await request.json()
        } catch {
          payload = {}
        }
        try {
          return reply(await handler({ endpoint, payload }))
        } catch (error) {
          logger.error(`task-orchestrator: 面板端点 ${endpoint} 失败：${describeError(error)}`)
          return reply({ ok: false, error: describeError(error) })
        }
      },
    })
  }
  return 'fetch'
}
