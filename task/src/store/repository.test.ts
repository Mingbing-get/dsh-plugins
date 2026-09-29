import { describe, expect, it } from 'vitest'
import { TaskStore } from './repository.ts'
import type { PreparedTask } from './repository.ts'

function prepared(id: string, dependsOn: string[] = []): PreparedTask {
  return {
    id,
    title: `任务 ${id}`,
    slug: `task-${id.toLowerCase()}`,
    documentPath: `docs/tasks/${id}-task.md`,
    acceptance: `验收 ${id}`,
    verifyCommands: ['pnpm test'],
    detail: { goal: '目标', scope: [], risks: '', rollback: '' },
    priority: 100,
    estimate: 'M',
    dependsOn,
  }
}

function storeWithProduct(): { store: TaskStore; productId: number } {
  const store = TaskStore.memory()
  const product = store.createProduct({
    slug: 'demo',
    title: '示例需求',
    documentPath: 'docs/products/demo.md',
    status: 'confirmed',
    featureDeltas: [],
  })
  return { store, productId: product.id }
}

describe('TaskStore', () => {
  it('allocates monotonic task ids that are never reused', () => {
    const store = TaskStore.memory()
    expect(store.reserveTaskIds(2)).toEqual(['T1', 'T2'])
    expect(store.reserveTaskIds(1)).toEqual(['T3'])
  })

  it('only offers tasks whose dependencies are satisfied', () => {
    const { store, productId } = storeWithProduct()
    const [a, b, c] = store.reserveTaskIds(3) as [string, string, string]
    store.createTasks(productId, [prepared(a), prepared(b, [a]), prepared(c, [b])])

    expect(store.executableTasks().map((task) => task.id)).toEqual([a])
    store.transition(a, 'running')
    store.transition(a, 'done', { commit: 'abc123' })
    expect(store.executableTasks().map((task) => task.id)).toEqual([b])
  })

  it('treats a skipped (cancelled) dependency as satisfied', () => {
    const { store, productId } = storeWithProduct()
    const [a, b] = store.reserveTaskIds(2) as [string, string]
    store.createTasks(productId, [prepared(a), prepared(b, [a])])
    store.transition(a, 'cancelled')
    expect(store.executableTasks().map((task) => task.id)).toEqual([b])
  })

  it('rejects illegal transitions', () => {
    const { store, productId } = storeWithProduct()
    const [a] = store.reserveTaskIds(1) as [string]
    store.createTasks(productId, [prepared(a)])
    expect(() => store.transition(a, 'done')).toThrowError(/不能从 pending 迁移到 done/u)

    store.transition(a, 'running')
    // Re-running the same transition must fail instead of silently overwriting.
    expect(() => store.transition(a, 'running')).toThrowError(/不能从 running 迁移到 running/u)

    store.transition(a, 'done', { commit: 'abc123' })
    expect(store.getTask(a)?.commit).toBe('abc123')
    expect(store.getTask(a)?.status).toBe('done')
    // `done` is terminal: reopening goes through `pending`, never straight back to running.
    expect(() => store.transition(a, 'running')).toThrowError(/不能从 done 迁移到 running/u)
  })

  it('rejects running a blocked task until it is released', () => {
    const { store, productId } = storeWithProduct()
    const [a] = store.reserveTaskIds(1) as [string]
    store.createTasks(productId, [prepared(a)])
    store.transition(a, 'blocked', { blockedReason: 'blocked_by T0' })
    expect(() => store.transition(a, 'running')).toThrowError(/不能从 blocked 迁移到 running/u)
    store.transition(a, 'pending', { blockedReason: null })
    expect(store.getTask(a)?.status).toBe('pending')
  })

  it('refreshes the open notification of a task instead of duplicating it', () => {
    const { store, productId } = storeWithProduct()
    const [a] = store.reserveTaskIds(1) as [string]
    store.createTasks(productId, [prepared(a)])
    const first = store.addNotification({
      taskId: a,
      kind: 'failed',
      title: '失败',
      message: '第一次',
    })
    const second = store.addNotification({
      taskId: a,
      kind: 'failed',
      title: '失败',
      message: '第二次',
    })
    expect(second.id).toBe(first.id)
    expect(store.listNotifications()).toHaveLength(1)
    expect(store.listNotifications()[0]?.message).toBe('第二次')
    expect(store.unreadCount()).toBe(1)
  })

  it('resolves every open notification of a task', () => {
    const { store, productId } = storeWithProduct()
    const [a] = store.reserveTaskIds(1) as [string]
    store.createTasks(productId, [prepared(a)])
    store.addNotification({ taskId: a, kind: 'failed', title: '失败', message: 'x' })
    store.resolveNotificationsForTask(a)
    expect(store.listNotifications()).toHaveLength(0)
    expect(store.listNotifications({ includeResolved: true })).toHaveLength(1)
  })

  it('guards the scheduler lock against a foreign owner until the lease expires', () => {
    const store = TaskStore.memory()
    expect(store.acquireLock('scheduler', 'a', 1000, 0)).toBe(true)
    expect(store.acquireLock('scheduler', 'b', 1000, 500)).toBe(false)
    expect(store.acquireLock('scheduler', 'b', 1000, 2000)).toBe(true)
    store.releaseLock('scheduler', 'a')
    expect(store.acquireLock('scheduler', 'c', 1000, 2000)).toBe(false)
  })

  it('records the dependency graph and transitive downstream tasks', () => {
    const { store, productId } = storeWithProduct()
    const [a, b, c] = store.reserveTaskIds(3) as [string, string, string]
    store.createTasks(productId, [prepared(a), prepared(b, [a]), prepared(c, [b])])
    expect(store.dependencyGraph().get(b)).toEqual([a])
    expect(store.transitiveDownstream(a).sort()).toEqual([b, c])
    expect(store.transitiveDownstream(c)).toEqual([])
  })
})
