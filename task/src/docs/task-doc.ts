/**
 * Task document renderer (`docs/tasks/<task-id>-<slug>.md`). The document is
 * regenerated from the database row, so its status line always matches the
 * authoritative record while the prose stays stable.
 */

import { orDash } from '../domain/text.ts'
import type { Estimate, TaskDetail, TaskStatus } from '../domain/types.ts'

/** Everything the renderer needs; mirrors the stored task row. */
export interface TaskDocumentInput {
  id: string
  title: string
  status: TaskStatus
  estimate: Estimate
  priority: number
  acceptance: string
  verifyCommands: string[]
  detail: TaskDetail
  dependsOn: string[]
  productSlug: string
  productDocumentPath: string
  createdAt: string
  commit: string | null
  attempt: number
  blockedReason: string | null
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: '待执行',
  running: '执行中',
  done: '已完成',
  failed: '失败',
  blocked: '阻塞',
  cancelled: '已取消',
}

/** Render one task document. */
export function renderTaskDocument(input: TaskDocumentInput): string {
  const lines: string[] = []
  lines.push(`# ${input.id} ${input.title}`, '')
  lines.push('## 元数据', '')
  lines.push(`- 任务编号：${input.id}`)
  lines.push(`- 状态：${STATUS_LABEL[input.status]}（${input.status}）`)
  lines.push(`- 依赖任务：${orDash(input.dependsOn)}`)
  lines.push(`- 来源需求：${input.productSlug}（${input.productDocumentPath}）`)
  lines.push(
    `- 工作量：${input.estimate}｜优先级：${String(input.priority)}｜尝试次数：${String(input.attempt)}`,
  )
  lines.push(`- 创建时间：${input.createdAt}`)
  lines.push(`- 完成提交：${input.commit ?? '—'}`)
  if (input.blockedReason !== null) lines.push(`- 阻塞原因：${input.blockedReason}`)
  lines.push('')

  lines.push('## 背景与目标', '', input.detail.goal.trim() || '（待补充）', '')

  lines.push('## 实现要求', '')
  if (input.detail.scope.length === 0) {
    lines.push('- （未声明范围，执行者需先确认影响面）', '')
  } else {
    lines.push(...input.detail.scope.map((item) => `- ${item}`), '')
  }

  lines.push('## 验收标准', '')
  const criteria = input.acceptance
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  lines.push(...(criteria.length > 0 ? criteria.map((line) => `- ${line}`) : ['- （待补充）']), '')

  lines.push('## 验证方式', '')
  lines.push(
    ...(input.verifyCommands.length > 0
      ? input.verifyCommands.map((command) => `- \`${command}\``)
      : ['- 未声明验证命令，以验收标准人工核对为准。']),
    '',
  )

  lines.push('## 风险与回滚', '')
  lines.push(`- 风险：${input.detail.risks.trim() || '—'}`)
  lines.push(`- 回滚：${input.detail.rollback.trim() || '—'}`, '')

  lines.push('## 执行约定', '')
  lines.push('- 直接在当前分支开发，不使用 git worktree。')
  lines.push('- 完成后必须独立提交一次，并在提交信息中包含任务编号。')
  lines.push('- 进度必须通过 `task_progress` 上报，禁止只改数据库或只改文档。')
  return `${lines
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trimEnd()}\n`
}
