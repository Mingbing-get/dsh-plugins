import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  applyFeatureDeltas,
  entriesFor,
  parseFeatureDocument,
  readFeatureSummary,
  renderFeatureDigest,
} from './features.ts'

const NOW = new Date('2026-09-29T10:00:00.000Z')

describe('system feature overview merge', () => {
  it('creates the file on the first confirmed requirement', () => {
    const result = applyFeatureDeltas(
      null,
      'task-orchestrator',
      [
        {
          op: 'add',
          domain: '需求梳理',
          name: '澄清循环',
          behavior: '不闭环不写码',
          state: '待实现',
        },
        { op: 'add', domain: '调度与执行', name: '串行调度', behavior: '一次一个任务' },
      ],
      { now: NOW },
    )
    expect(result.content).toMatch(/# 系统功能全景/u)
    expect(result.content).toMatch(/- 最后更新：2026-09-29（task-orchestrator）/u)
    expect(result.content).toMatch(/- 覆盖需求：task-orchestrator/u)
    expect(result.content).toMatch(/## 功能域：需求梳理/u)
    expect(result.content).toMatch(/### 澄清循环/u)
    expect(result.changes).toEqual([
      { op: 'add', domain: '需求梳理', name: '澄清循环' },
      { op: 'add', domain: '调度与执行', name: '串行调度' },
    ])
  })

  it('merges a second requirement without rewriting existing entries', () => {
    const first = applyFeatureDeltas(
      null,
      'alpha',
      [{ op: 'add', domain: '需求梳理', name: '澄清循环', behavior: '第一版行为描述' }],
      { now: NOW },
    )
    const second = applyFeatureDeltas(
      first.content,
      'beta',
      [{ op: 'add', domain: '需求梳理', name: '复杂度判定', behavior: '简单需求直接建一个任务' }],
      { now: NOW },
    )
    const summary = readFeatureSummary(second.content)
    expect(summary.coveredSlugs).toEqual(['alpha', 'beta'])
    const domain = summary.domains.find((item) => item.name === '需求梳理')
    expect(domain?.entries.map((entry) => entry.name)).toEqual(['澄清循环', '复杂度判定'])
    // The untouched entry keeps its original body verbatim.
    const untouched = (first.content.split('### 澄清循环')[1] ?? '').split(
      /\n#{2,3} /u,
    )[0] as string
    expect(untouched.trim().length).toBeGreaterThan(0)
    expect(second.content).toContain(untouched)
  })

  it('only rewrites the entry a delta names', () => {
    const first = applyFeatureDeltas(
      null,
      'alpha',
      [
        { op: 'add', domain: '需求梳理', name: '澄清循环', behavior: '旧行为' },
        { op: 'add', domain: '需求梳理', name: '复杂度判定', behavior: '保持原样' },
      ],
      { now: NOW },
    )
    const second = applyFeatureDeltas(
      first.content,
      'alpha',
      [{ op: 'update', domain: '需求梳理', name: '澄清循环', behavior: '新行为' }],
      { now: NOW },
    )
    expect(second.content).toContain('- 行为描述：新行为')
    expect(second.content).toContain('- 行为描述：保持原样')
    expect(second.content).not.toContain('旧行为')
    expect(second.changes).toEqual([{ op: 'update', domain: '需求梳理', name: '澄清循环' }])
  })

  it('keeps unspecified fields of an updated entry', () => {
    const first = applyFeatureDeltas(
      null,
      'alpha',
      [{ op: 'add', domain: '任务拆解', name: 'DAG 校验', behavior: '拒绝环', state: '待实现' }],
      { now: NOW },
    )
    const second = applyFeatureDeltas(
      first.content,
      'alpha',
      [{ op: 'update', domain: '任务拆解', name: 'DAG 校验', state: '已实现', taskIds: ['T1'] }],
      { now: NOW },
    )
    const entry = readFeatureSummary(second.content).domains[0]?.entries[0]
    expect(entry?.state).toBe('已实现')
    expect(entry?.behavior).toBe('拒绝环')
    expect(entry?.taskIds).toEqual(['T1'])
  })

  it('removes an entry and drops the domain once it is empty', () => {
    const first = applyFeatureDeltas(
      null,
      'alpha',
      [{ op: 'add', domain: '临时域', name: '临时功能', behavior: 'x' }],
      { now: NOW },
    )
    const second = applyFeatureDeltas(
      first.content,
      'alpha',
      [{ op: 'remove', domain: '临时域', name: '临时功能' }],
      { now: NOW },
    )
    expect(second.content).not.toContain('## 功能域：临时域')
  })

  it('appends an auditable changelog row per merge', () => {
    const first = applyFeatureDeltas(
      null,
      'alpha',
      [{ op: 'add', domain: '需求梳理', name: '澄清循环', behavior: 'x' }],
      { now: NOW },
    )
    const second = applyFeatureDeltas(
      first.content,
      'beta',
      [{ op: 'add', domain: '需求梳理', name: '复杂度判定', behavior: 'y' }],
      { now: NOW, note: '任务 T2 完成' },
    )
    const rows = second.content.split('\n').filter((line) => line.startsWith('| 2026-09-29'))
    expect(rows).toHaveLength(2)
    expect(rows[1]).toContain('| beta | 任务 T2 完成 |')
  })

  it('round-trips a hand-written document without touching its prose', () => {
    const handwritten = [
      '# 系统功能全景',
      '',
      '- 最后更新：2026-01-01（legacy）',
      '- 覆盖需求：legacy',
      '',
      '## 功能域：手写域',
      '',
      '这里是自由发挥的说明文字。',
      '',
      '### 手写条目',
      '',
      '- 来源需求：legacy',
      '- 状态：已实现',
      '- 行为描述：保持原样',
      '- 关联任务：T9',
      '',
      '## 附录',
      '',
      '人工维护的附录段落。',
      '',
    ].join('\n')
    const doc = parseFeatureDocument(handwritten)
    expect(doc.sections.map((section) => section.kind)).toEqual(['domain', 'raw'])
    const result = applyFeatureDeltas(
      handwritten,
      'alpha',
      [{ op: 'add', domain: '手写域', name: '新条目', behavior: '新增' }],
      { now: NOW },
    )
    expect(result.content).toContain('这里是自由发挥的说明文字。')
    expect(result.content).toContain('- 行为描述：保持原样')
    expect(result.content).toContain('人工维护的附录段落。')
    expect(result.content).toContain('覆盖需求：legacy、alpha')
  })

  it('keeps hand-written annotations of an entry it regenerates', () => {
    const handwritten = [
      '# 系统功能全景',
      '',
      '- 最后更新：2026-01-01（legacy）',
      '- 覆盖需求：legacy',
      '',
      '## 功能域：手写域',
      '',
      '### 手写条目',
      '',
      '- 来源需求：legacy',
      '- 状态：待实现',
      '- 行为描述：第一行说明',
      '  续写到第二行',
      '- 关联任务：—',
      '- 更新记录：2026-01-01 人工登记',
      '',
    ].join('\n')
    const entry = readFeatureSummary(handwritten).domains[0]?.entries[0]
    expect(entry?.behavior).toBe('第一行说明 续写到第二行')
    expect(entry?.extras).toEqual(['- 更新记录：2026-01-01 人工登记'])
    const result = applyFeatureDeltas(
      handwritten,
      'legacy',
      [{ op: 'update', domain: '手写域', name: '手写条目', state: '已实现' }],
      { now: NOW },
    )
    expect(result.content).toContain('- 状态：已实现')
    expect(result.content).toContain('- 行为描述：第一行说明 续写到第二行')
    expect(result.content).toContain('- 更新记录：2026-01-01 人工登记')
  })

  it("round-trips the plugin's own overview without rewriting its prose", () => {
    const path = fileURLToPath(new URL('../../docs/products/system-features.md', import.meta.url))
    const content = readFileSync(path, 'utf8')
    const summary = readFeatureSummary(content)
    expect(summary.domains.length).toBeGreaterThan(0)
    expect(summary.coveredSlugs).toContain('task-orchestrator')
    const applied = applyFeatureDeltas(content, 'task-orchestrator', [], { now: NOW })
    for (const domain of summary.domains) {
      expect(applied.content).toContain(`## 功能域：${domain.name}`)
      for (const entry of domain.entries) {
        expect(applied.content, entry.name).toContain(`### ${entry.name}`)
        expect(applied.content, entry.name).toContain(entry.behavior)
      }
    }
  })

  it('finds entries by requirement and by task', () => {
    const result = applyFeatureDeltas(
      null,
      'alpha',
      [{ op: 'add', domain: '需求梳理', name: '澄清循环', behavior: 'x', taskIds: ['T1'] }],
      { now: NOW },
    )
    const summary = readFeatureSummary(result.content)
    expect(entriesFor(summary, { slug: 'alpha' })).toHaveLength(1)
    expect(entriesFor(summary, { taskId: 'T1' })).toHaveLength(1)
    expect(entriesFor(summary, { taskId: 'T2' })).toHaveLength(0)
    expect(renderFeatureDigest(summary)).toContain('澄清循环（待实现）')
  })
})
