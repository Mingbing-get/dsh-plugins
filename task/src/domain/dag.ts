/**
 * Dependency-graph validation. Plans are rejected as a whole when they contain
 * a cycle, an unknown reference, or a self-dependency, so the store never sees
 * a partially written graph.
 */

import { invalidArgument } from './errors.ts'

/** One node of a proposed plan. */
export interface GraphNode {
  /** Planner-local stable key. */
  key: string
  /** Keys this node depends on. */
  dependsOn?: readonly string[] | undefined
}

/**
 * Find a cycle in a dependency map.
 * @param edges - adjacency list keyed by node.
 * @returns the cycle path (`['T1', 'T2', 'T1']`) or `null` when acyclic.
 */
export function findCycle(edges: ReadonlyMap<string, readonly string[]>): string[] | null {
  const state = new Map<string, 'visiting' | 'done'>()
  const stack: string[] = []

  const visit = (node: string): string[] | null => {
    const current = state.get(node)
    if (current === 'done') return null
    if (current === 'visiting') {
      const start = stack.indexOf(node)
      return [...stack.slice(start), node]
    }
    state.set(node, 'visiting')
    stack.push(node)
    for (const next of edges.get(node) ?? []) {
      const cycle = visit(next)
      if (cycle !== null) return cycle
    }
    stack.pop()
    state.set(node, 'done')
    return null
  }

  for (const node of edges.keys()) {
    const cycle = visit(node)
    if (cycle !== null) return cycle
  }
  return null
}

/**
 * Validate a proposed plan graph.
 *
 * Checks duplicate keys, self-dependencies, unknown references, and cycles.
 * @param nodes - plan nodes.
 * @returns the edges map (node -> dependencies) after validation.
 */
export function validatePlanGraph(nodes: readonly GraphNode[]): Map<string, string[]> {
  if (nodes.length === 0) throw invalidArgument('拆解结果为空：至少需要一个任务')
  const edges = new Map<string, string[]>()
  for (const node of nodes) {
    if (node.key.length === 0) throw invalidArgument('任务 key 不能为空')
    if (edges.has(node.key)) throw invalidArgument(`任务 key 重复：${node.key}`)
    edges.set(node.key, [])
  }
  for (const node of nodes) {
    const deps = node.dependsOn ?? []
    const unique = new Set<string>()
    for (const dep of deps) {
      if (dep === node.key) throw invalidArgument(`任务 ${node.key} 不能依赖自身`)
      if (!edges.has(dep)) throw invalidArgument(`任务 ${node.key} 依赖了不存在的任务 ${dep}`)
      if (unique.has(dep)) throw invalidArgument(`任务 ${node.key} 重复依赖 ${dep}`)
      unique.add(dep)
    }
    edges.set(node.key, [...unique])
  }
  const cycle = findCycle(edges)
  if (cycle !== null) {
    throw invalidArgument(`依赖关系存在环：${cycle.join(' → ')}`, { cycle })
  }
  return edges
}

/**
 * Validate a stored dependency map (used before persisting a manual edit).
 * @param edges - adjacency list keyed by existing task id.
 */
export function assertAcyclic(edges: ReadonlyMap<string, readonly string[]>): void {
  const cycle = findCycle(edges)
  if (cycle !== null) {
    throw invalidArgument(`依赖关系存在环：${cycle.join(' → ')}`, { cycle })
  }
}

/**
 * Topological order of a validated graph (dependencies first).
 * @param edges - adjacency list.
 * @returns keys in a dependency-respecting order.
 */
export function topologicalOrder(edges: ReadonlyMap<string, readonly string[]>): string[] {
  const order: string[] = []
  const seen = new Set<string>()
  const visit = (node: string): void => {
    if (seen.has(node)) return
    seen.add(node)
    for (const dep of edges.get(node) ?? []) visit(dep)
    order.push(node)
  }
  for (const node of edges.keys()) visit(node)
  return order
}
