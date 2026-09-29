/**
 * Requirement document renderer (`docs/products/<slug>.md`). The analyst model
 * supplies structured content; this module owns the layout so every generated
 * document has the sections the workflow and the reviewers expect.
 */

import { orDash } from '../domain/text.ts'
import type { FeatureDelta, OpenQuestion } from '../domain/types.ts'

/** Structured content of one requirement document. */
export interface RequirementDraft {
  title: string
  slug: string
  /** 背景与目标 prose. */
  background: string
  /** Goal bullets. */
  goals: string[]
  /** Explicit non-goals. */
  nonGoals: string[]
  /** Functional requirements. */
  functionalRequirements: { title: string; detail: string }[]
  /** Feature changes this requirement brings to the overview. */
  featureDeltas: FeatureDelta[]
  /** Technical constraints and data structures. */
  technicalConstraints: string
  /** Verifiable acceptance criteria. */
  acceptance: string[]
  /** Still-open questions (empty once the requirement is closed). */
  openQuestions: OpenQuestion[]
}

/** Provenance lines written into the document header. */
export interface RequirementMeta {
  status: string
  createdAt: string
  commit?: string | null
}

const OPERATION_LABEL: Record<FeatureDelta['op'], string> = {
  add: '新增',
  update: '修改',
  remove: '下线',
}

function bulletList(values: readonly string[], fallback: string): string {
  if (values.length === 0) return `- ${fallback}`
  return values.map((value) => `- ${value}`).join('\n')
}

/** Render one requirement document. */
export function renderRequirementDocument(draft: RequirementDraft, meta: RequirementMeta): string {
  const lines: string[] = []
  lines.push(`# ${draft.title}`, '')
  lines.push('## 元数据', '')
  lines.push(`- 需求 slug：${draft.slug}`)
  lines.push(`- 状态：${meta.status}`)
  lines.push(`- 创建时间：${meta.createdAt}`)
  lines.push(`- 确认提交：${meta.commit ?? '—'}`, '')

  lines.push('## 1. 背景与目标', '', draft.background.trim() || '（待补充）', '')
  lines.push('### 目标', '', bulletList(draft.goals, '（待补充）'), '')

  lines.push('## 2. 非目标', '', bulletList(draft.nonGoals, '本次不做额外范围。'), '')

  lines.push('## 3. 功能需求', '')
  if (draft.functionalRequirements.length === 0) {
    lines.push('- （待补充）', '')
  } else {
    for (const [index, item] of draft.functionalRequirements.entries()) {
      lines.push(
        `### 3.${String(index + 1)} ${item.title}`,
        '',
        item.detail.trim() || '（待补充）',
        '',
      )
    }
  }

  lines.push('## 4. 本次需求带来的功能更新点', '')
  lines.push('> 以下条目在需求确认时已增量合并进 `docs/products/system-features.md`。', '')
  if (draft.featureDeltas.length === 0) {
    lines.push('- （无功能变更）', '')
  } else {
    for (const delta of draft.featureDeltas) {
      const state = delta.state ?? '待实现'
      const tasks = orDash(delta.taskIds ?? [])
      lines.push(`- 【${OPERATION_LABEL[delta.op]}】${delta.domain} / ${delta.name}`)
      lines.push(`  - 行为描述：${delta.behavior ?? '—'}`)
      lines.push(`  - 状态：${state}`)
      lines.push(`  - 关联任务：${tasks}`)
    }
    lines.push('')
  }

  lines.push('## 5. 技术约束与数据结构', '', draft.technicalConstraints.trim() || '（待补充）', '')

  lines.push('## 6. 验收标准', '', bulletList(draft.acceptance, '（待补充）'), '')

  lines.push('## 7. 开放问题', '')
  if (draft.openQuestions.length === 0) {
    lines.push('- 无。', '')
  } else {
    for (const question of draft.openQuestions) {
      lines.push(`- ${question.question}`)
      if (question.detail !== undefined) lines.push(`  - 补充：${question.detail}`)
    }
    lines.push('')
  }
  return `${lines
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trimEnd()}\n`
}
