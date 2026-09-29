import { describe, expect, it } from 'vitest'
import { assertAcyclic, findCycle, topologicalOrder, validatePlanGraph } from './dag.ts'
import { canTransition, isTerminal, parseTaskStatus, TASK_STATUSES } from './status.ts'
import { clamp, isSlug, nonEmptyLines, orDash, resolveSlug, slugify } from './text.ts'
import { DocPaths } from '../docs/paths.ts'

describe('slug and text helpers', () => {
  it('normalizes ASCII titles into kebab-case slugs', () => {
    expect(slugify('Task Orchestrator Plugin!')).toBe('task-orchestrator-plugin')
    expect(slugify('  Multiple   spaces  ')).toBe('multiple-spaces')
    expect(slugify('A'.repeat(120))).toHaveLength(60)
  })

  it('falls back when a title has no ASCII content', () => {
    expect(slugify('任务编排插件')).toBe('requirement')
    expect(slugify('任务编排插件', 'task')).toBe('task')
    expect(resolveSlug(undefined, '任务编排', 'task')).toBe('task')
    expect(resolveSlug('explicit-slug', '任务编排')).toBe('explicit-slug')
  })

  it('validates explicit slugs', () => {
    expect(isSlug('system-features')).toBe(true)
    expect(isSlug('System Features')).toBe(false)
    expect(isSlug('-leading')).toBe(false)
    expect(isSlug('has_underscore')).toBe(false)
  })

  it('clamps and flattens text', () => {
    expect(clamp('a\n\n  b   c', 100)).toBe('a b c')
    expect(clamp('x'.repeat(20), 10)).toHaveLength(10)
    expect(orDash([])).toBe('—')
    expect(orDash(['T1', 'T2'])).toBe('T1、T2')
    expect(nonEmptyLines('a\n\n  b  \n')).toEqual(['a', 'b'])
  })
})

describe('task state machine', () => {
  it('allows the documented transitions', () => {
    expect(canTransition('pending', 'running')).toBe(true)
    expect(canTransition('running', 'done')).toBe(true)
    expect(canTransition('running', 'pending')).toBe(true)
    expect(canTransition('blocked', 'pending')).toBe(true)
    expect(canTransition('failed', 'pending')).toBe(true)
    expect(canTransition('done', 'running')).toBe(false)
    expect(canTransition('cancelled', 'running')).toBe(false)
    expect(isTerminal('done')).toBe(true)
    expect(isTerminal('cancelled')).toBe(true)
    expect(isTerminal('failed')).toBe(false)
  })

  it('rejects unknown statuses', () => {
    for (const status of TASK_STATUSES) expect(parseTaskStatus(status)).toBe(status)
    expect(() => parseTaskStatus('nope')).toThrowError(/未知的任务状态/u)
  })
})

describe('dependency graph validation', () => {
  it('accepts a DAG and orders it dependencies-first', () => {
    const edges = validatePlanGraph([
      { key: 'c', dependsOn: ['b'] },
      { key: 'b', dependsOn: ['a'] },
      { key: 'a' },
    ])
    expect(topologicalOrder(edges)).toEqual(['a', 'b', 'c'])
  })

  it('rejects self dependencies, unknown references and duplicates', () => {
    expect(() => validatePlanGraph([{ key: 'a', dependsOn: ['a'] }])).toThrowError(/不能依赖自身/u)
    expect(() => validatePlanGraph([{ key: 'a', dependsOn: ['ghost'] }])).toThrowError(
      /不存在的任务/u,
    )
    expect(() => validatePlanGraph([{ key: 'a' }, { key: 'a' }])).toThrowError(/key 重复/u)
    expect(() => validatePlanGraph([])).toThrowError(/至少需要一个任务/u)
  })

  it('reports the actual cycle', () => {
    const edges = new Map<string, string[]>([
      ['T1', ['T3']],
      ['T2', ['T1']],
      ['T3', ['T2']],
    ])
    const cycle = findCycle(edges)
    expect(cycle).not.toBeNull()
    expect(cycle?.[0]).toBe(cycle?.[cycle.length - 1])
    expect(() => assertAcyclic(edges)).toThrowError(/存在环/u)
  })

  it('rejects a cyclic plan as a whole', () => {
    expect(() =>
      validatePlanGraph([
        { key: 'a', dependsOn: ['b'] },
        { key: 'b', dependsOn: ['a'] },
      ]),
    ).toThrowError(/存在环：a → b → a/u)
  })
})

describe('document paths', () => {
  const paths = new DocPaths('/repo', 'docs', 'system-features.md')

  it('derives the documented locations', () => {
    expect(paths.productDoc('demo')).toBe('/repo/docs/products/demo.md')
    expect(paths.taskDoc('T3', 'build-store')).toBe('/repo/docs/tasks/T3-build-store.md')
    expect(paths.systemFeaturesPath).toBe('/repo/docs/products/system-features.md')
    expect(paths.toRelative(paths.taskDoc('T3', 'build-store'))).toBe(
      'docs/tasks/T3-build-store.md',
    )
  })

  it('refuses to escape the docs tree', () => {
    expect(() => paths.productDoc('../../etc/passwd')).toThrowError(/必须位于/u)
    expect(() => paths.taskDoc('T1', '../../../etc/passwd')).toThrowError(/必须位于/u)
  })
})
