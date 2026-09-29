/**
 * System feature overview (`docs/products/system-features.md`).
 *
 * The file is the human-readable projection of every confirmed requirement.
 * Updates are incremental by construction: untouched sections are re-emitted
 * from their verbatim source lines, and only the entries a delta names are
 * regenerated, so an existing description can never be silently rewritten.
 */

import { orDash } from '../domain/text.ts'
import type { FeatureDelta, FeatureState } from '../domain/types.ts'

const TITLE = '# 系统功能全景'
const DOMAIN_PREFIX = '## 功能域：'
const CHANGELOG_HEADING = '## 变更记录'
const ENTRY_PREFIX = '### '
const CHANGELOG_HEADER = ['| 时间 | 需求 | 变更 |', '| ---- | ---- | ---- |']

/** One feature point inside a domain. */
export interface FeatureEntry {
  name: string
  source: string
  state: string
  behavior: string
  taskIds: string[]
  /**
   * Unrecognised body lines (hand-added notes such as an update log). Kept so a
   * regenerated entry never silently drops a human's annotation.
   */
  extras: string[]
  /** Verbatim body lines, excluding the `### name` heading. */
  raw: string[]
}

/** One feature domain section. */
export interface FeatureDomain {
  name: string
  lead: string[]
  entries: FeatureEntry[]
  /** Verbatim lines of the whole section, used while the domain is untouched. */
  raw: string[]
  dirty: boolean
}

interface ChangelogSection {
  heading: string
  rows: string[]
  raw: string[]
  dirty: boolean
}

type Section =
  | { kind: 'domain'; domain: FeatureDomain }
  | { kind: 'changelog'; changelog: ChangelogSection }
  | { kind: 'raw'; lines: string[] }

/** Parsed representation of the overview. */
export interface FeatureDocument {
  preamble: string[]
  sections: Section[]
}

/** Flat summary handed to the model and the panel. */
export interface FeatureSummary {
  lastUpdated: string | null
  coveredSlugs: string[]
  domains: { name: string; entries: FeatureEntry[] }[]
}

/** One applied delta, echoed back to the caller. */
export interface FeatureChange {
  op: FeatureDelta['op']
  domain: string
  name: string
}

/** Result of one incremental merge. */
export interface ApplyFeatureDeltasResult {
  content: string
  changes: FeatureChange[]
  coveredSlugs: string[]
  summary: FeatureSummary
}

function trimBlank(lines: readonly string[]): string[] {
  let start = 0
  let end = lines.length
  while (start < end && (lines[start] as string).trim().length === 0) start += 1
  while (end > start && (lines[end - 1] as string).trim().length === 0) end -= 1
  return lines.slice(start, end)
}

const FIELD_PATTERN = /^-\s*(来源需求|状态|行为描述|关联任务)\s*[：:]\s*(.*)$/u

/** Reduce `[slug](./slug.md)` to `slug` so hand-written links stay parseable. */
function normalizeReference(value: string): string {
  const trimmed = value.trim()
  const link = /^\[([^\]]+)\]\([^)]*\)$/u.exec(trimmed)
  return (link?.[1] ?? trimmed).trim()
}

function parseEntry(name: string, raw: readonly string[]): FeatureEntry {
  const entry: FeatureEntry = {
    name,
    source: '',
    state: '待实现',
    behavior: '',
    taskIds: [],
    extras: [],
    raw: [...raw],
  }
  let field: 'source' | 'state' | 'behavior' | 'taskIds' | null = null
  for (const line of raw) {
    const match = FIELD_PATTERN.exec(line.trim())
    if (match !== null) {
      const label = match[1] as string
      const value = (match[2] as string).trim()
      if (label === '来源需求') {
        entry.source = value === '—' ? '' : normalizeReference(value)
        field = 'source'
      } else if (label === '状态') {
        entry.state = value.length > 0 ? value : '待实现'
        field = 'state'
      } else if (label === '行为描述') {
        entry.behavior = value
        field = 'behavior'
      } else {
        entry.taskIds =
          value === '—' || value.length === 0
            ? []
            : value
                .split(/[、,，]/u)
                .map((item) => item.trim())
                .filter((item) => item.length > 0)
        field = 'taskIds'
      }
      continue
    }
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    // Continuation line of the previous field (multi-line behaviour descriptions).
    if (field === 'behavior' && !trimmed.startsWith('- ')) {
      entry.behavior = entry.behavior.length === 0 ? trimmed : `${entry.behavior} ${trimmed}`
      continue
    }
    // Anything else is a human annotation this tool does not own; keep it.
    entry.extras.push(trimmed)
  }
  return entry
}

/** Render the verbatim body of one entry. */
function renderEntryBody(entry: FeatureEntry): string[] {
  return [
    `- 来源需求：${entry.source.length > 0 ? entry.source : '—'}`,
    `- 状态：${entry.state}`,
    `- 行为描述：${entry.behavior}`,
    `- 关联任务：${orDash(entry.taskIds)}`,
    ...entry.extras,
  ]
}

function renderEntry(entry: FeatureEntry): string {
  return [`${ENTRY_PREFIX}${entry.name}`, ...renderEntryBody(entry)].join('\n\n')
}

function renderDomain(domain: FeatureDomain): string {
  if (!domain.dirty) return domain.raw.join('\n')
  const blocks = [`${DOMAIN_PREFIX}${domain.name}`]
  if (domain.lead.length > 0) blocks.push(domain.lead.join('\n'))
  for (const entry of domain.entries) blocks.push(renderEntry(entry))
  return blocks.join('\n\n')
}

function renderChangelog(changelog: ChangelogSection): string {
  if (!changelog.dirty) return changelog.raw.join('\n')
  // Table rows must stay contiguous: a blank line would end the table.
  return [changelog.heading, '', ...changelog.rows].join('\n')
}

/** Render a parsed overview back to Markdown. */
export function renderFeatureDocument(doc: FeatureDocument): string {
  const blocks: string[] = []
  if (doc.preamble.length > 0) blocks.push(doc.preamble.join('\n'))
  for (const section of doc.sections) {
    if (section.kind === 'domain') blocks.push(renderDomain(section.domain))
    else if (section.kind === 'changelog') blocks.push(renderChangelog(section.changelog))
    else blocks.push(section.lines.join('\n'))
  }
  return `${blocks.join('\n\n')}\n`
}

function splitSections(lines: readonly string[]): {
  preamble: string[]
  rawSections: { heading: string; lines: string[] }[]
} {
  const preamble: string[] = []
  const rawSections: { heading: string; lines: string[] }[] = []
  let current: { heading: string; lines: string[] } | null = null
  for (const line of lines) {
    if (line.startsWith('## ')) {
      current = { heading: line, lines: [line] }
      rawSections.push(current)
      continue
    }
    if (current === null) preamble.push(line)
    else current.lines.push(line)
  }
  return { preamble: trimBlank(preamble), rawSections }
}

function parseDomain(heading: string, lines: readonly string[]): FeatureDomain {
  const name = heading.slice(DOMAIN_PREFIX.length).trim()
  const body = lines.slice(1)
  const lead: string[] = []
  const entries: FeatureEntry[] = []
  let currentName: string | null = null
  let currentBody: string[] = []
  const flush = (): void => {
    if (currentName === null) return
    entries.push(parseEntry(currentName, trimBlank(currentBody)))
    currentName = null
    currentBody = []
  }
  for (const line of body) {
    if (line.startsWith(ENTRY_PREFIX)) {
      flush()
      currentName = line.slice(ENTRY_PREFIX.length).trim()
      continue
    }
    if (currentName === null) lead.push(line)
    else currentBody.push(line)
  }
  flush()
  return { name, lead: trimBlank(lead), entries, raw: [...lines], dirty: false }
}

function parseChangelog(heading: string, lines: readonly string[]): ChangelogSection {
  const rows = lines.slice(1).filter((line) => line.trim().startsWith('|'))
  return { heading, rows, raw: [...lines], dirty: false }
}

/** Parse the overview. A missing or empty file yields an empty document. */
export function parseFeatureDocument(content: string): FeatureDocument {
  const { preamble, rawSections } = splitSections(content.split(/\r?\n/u))
  const sections: Section[] = rawSections.map((section) => {
    if (section.heading.startsWith(DOMAIN_PREFIX)) {
      return { kind: 'domain', domain: parseDomain(section.heading, section.lines) }
    }
    if (section.heading.startsWith(CHANGELOG_HEADING)) {
      return { kind: 'changelog', changelog: parseChangelog(section.heading, section.lines) }
    }
    if (section.heading.startsWith('## 功能域')) {
      return {
        kind: 'domain',
        domain: parseDomain(`${DOMAIN_PREFIX}${section.heading.slice(5).trim()}`, section.lines),
      }
    }
    return { kind: 'raw', lines: section.lines }
  })
  return { preamble, sections }
}

function metaValue(preamble: readonly string[], label: string): string | null {
  const prefix = `- ${label}：`
  for (const line of preamble) {
    if (line.startsWith(prefix)) return line.slice(prefix.length).trim()
  }
  return null
}

function parseCoveredSlugs(preamble: readonly string[]): string[] {
  const raw = metaValue(preamble, '覆盖需求')
  if (raw === null || raw.length === 0 || raw === '—') return []
  return raw
    .split(/[、,，]/u)
    .map((item) => normalizeReference(item))
    .filter((item) => item.length > 0)
}

function emptyPreamble(): string[] {
  return [TITLE, '', '- 最后更新：—', '- 覆盖需求：—']
}

function updatePreamble(
  preamble: readonly string[],
  slug: string,
  now: Date,
  covered: string[],
): string[] {
  const base = preamble.length > 0 ? [...preamble] : emptyPreamble()
  const date = now.toISOString().slice(0, 10)
  const extras = base.filter(
    (line) => !line.startsWith('- 最后更新：') && !line.startsWith('- 覆盖需求：'),
  )
  const title = extras.find((line) => line.startsWith('# ')) ?? TITLE
  const others = extras.filter((line) => !line.startsWith('# ') && line.trim().length > 0)
  return [
    title,
    '',
    `- 最后更新：${date}（${slug}）`,
    `- 覆盖需求：${covered.join('、')}`,
    ...(others.length > 0 ? ['', ...others] : []),
  ]
}

function summaryOf(changes: readonly FeatureChange[], note: string | undefined): string {
  if (note !== undefined && note.length > 0) return note
  if (changes.length === 0) return '无条目变化'
  const label: Record<FeatureDelta['op'], string> = { add: '新增', update: '更新', remove: '移除' }
  return changes
    .map((change) => `${label[change.op]}「${change.name}」（${change.domain}）`)
    .join('；')
}

function findDomain(doc: FeatureDocument, name: string): FeatureDomain | null {
  for (const section of doc.sections) {
    if (section.kind === 'domain' && section.domain.name === name) return section.domain
  }
  return null
}

function insertDomain(doc: FeatureDocument, domain: FeatureDomain): void {
  const changelogIndex = doc.sections.findIndex((section) => section.kind === 'changelog')
  const section: Section = { kind: 'domain', domain }
  if (changelogIndex === -1) doc.sections.push(section)
  else doc.sections.splice(changelogIndex, 0, section)
}

function ensureChangelog(doc: FeatureDocument): ChangelogSection {
  for (const section of doc.sections) {
    if (section.kind === 'changelog') return section.changelog
  }
  const changelog: ChangelogSection = {
    heading: CHANGELOG_HEADING,
    rows: [...CHANGELOG_HEADER],
    raw: [],
    dirty: true,
  }
  doc.sections.push({ kind: 'changelog', changelog })
  return changelog
}

/**
 * Merge feature deltas into the overview.
 * @param content - current file content, or `null` when the file does not exist.
 * @param slug - requirement slug that owns these changes.
 * @param deltas - incremental changes.
 * @param options - clock and an optional explicit changelog note.
 * @returns the new content, the applied changes, and the parsed result.
 */
export function applyFeatureDeltas(
  content: string | null | undefined,
  slug: string,
  deltas: readonly FeatureDelta[],
  options: { now?: Date; note?: string } = {},
): ApplyFeatureDeltasResult {
  const now = options.now ?? new Date()
  const doc =
    content === null || content === undefined || content.trim().length === 0
      ? { preamble: emptyPreamble(), sections: [] as Section[] }
      : parseFeatureDocument(content)
  const changes: FeatureChange[] = []

  for (const delta of deltas) {
    const name = delta.name.trim()
    const domainName = delta.domain.trim()
    if (name.length === 0 || domainName.length === 0) continue
    let domain = findDomain(doc, domainName)
    if (domain === null) {
      if (delta.op === 'remove') continue
      domain = { name: domainName, lead: [], entries: [], raw: [], dirty: true }
      insertDomain(doc, domain)
    }
    const index = domain.entries.findIndex((entry) => entry.name === name)
    if (delta.op === 'remove') {
      if (index === -1) continue
      domain.entries.splice(index, 1)
      domain.dirty = true
      changes.push({ op: 'remove', domain: domainName, name })
      continue
    }
    const state: FeatureState = delta.state ?? '待实现'
    const previous = index === -1 ? undefined : (domain.entries[index] as FeatureEntry)
    const next: FeatureEntry = {
      name,
      source: slug,
      state,
      behavior: delta.behavior?.trim() ?? '',
      taskIds: delta.taskIds ?? [],
      extras: previous?.extras ?? [],
      raw: [],
    }
    if (index === -1) {
      // Keep existing entries' order stable; new points land at the end.
      domain.entries.push(next)
      changes.push({ op: 'add', domain: domainName, name })
    } else {
      const kept = previous as FeatureEntry
      if (delta.behavior === undefined) next.behavior = kept.behavior
      if (delta.state === undefined) next.state = kept.state
      if (delta.taskIds === undefined) next.taskIds = kept.taskIds
      if (kept.source.length > 0) next.source = kept.source
      domain.entries[index] = next
      changes.push({ op: 'update', domain: domainName, name })
    }
    domain.dirty = true
  }

  // Drop domains whose last entry was removed and that carry no prose.
  doc.sections = doc.sections.filter((section) => {
    if (section.kind !== 'domain') return true
    return section.domain.entries.length > 0 || section.domain.lead.length > 0
  })

  const covered = parseCoveredSlugs(doc.preamble)
  if (!covered.includes(slug)) covered.push(slug)
  doc.preamble = updatePreamble(doc.preamble, slug, now, covered)

  if (changes.length > 0 || options.note !== undefined) {
    const changelog = ensureChangelog(doc)
    if (changelog.rows.length === 0) changelog.rows.push(...CHANGELOG_HEADER)
    changelog.rows.push(
      `| ${now.toISOString().slice(0, 10)} | ${slug} | ${summaryOf(changes, options.note)} |`,
    )
    changelog.dirty = true
  }

  return {
    content: renderFeatureDocument(doc),
    changes,
    coveredSlugs: covered,
    summary: summarizeFeatureDocument(doc),
  }
}

function summarizeFeatureDocument(doc: FeatureDocument): FeatureSummary {
  const domains: { name: string; entries: FeatureEntry[] }[] = []
  for (const section of doc.sections) {
    if (section.kind === 'domain') {
      domains.push({ name: section.domain.name, entries: section.domain.entries })
    }
  }
  return {
    lastUpdated: metaValue(doc.preamble, '最后更新'),
    coveredSlugs: parseCoveredSlugs(doc.preamble),
    domains,
  }
}

/** Read a summary of the overview without mutating it. */
export function readFeatureSummary(content: string | null | undefined): FeatureSummary {
  if (content === null || content === undefined || content.trim().length === 0) {
    return { lastUpdated: null, coveredSlugs: [], domains: [] }
  }
  return summarizeFeatureDocument(parseFeatureDocument(content))
}

/** Entries whose source requirement or task list matches the filter. */
export function entriesFor(
  summary: FeatureSummary,
  filter: { slug?: string; taskId?: string },
): { domain: string; entry: FeatureEntry }[] {
  const matches: { domain: string; entry: FeatureEntry }[] = []
  for (const domain of summary.domains) {
    for (const entry of domain.entries) {
      const bySlug = filter.slug !== undefined && entry.source === filter.slug
      const byTask = filter.taskId !== undefined && entry.taskIds.includes(filter.taskId)
      if (bySlug || byTask) matches.push({ domain: domain.name, entry })
    }
  }
  return matches
}

/** Render a compact plain-text digest used by tools and the `/task features` command. */
export function renderFeatureDigest(summary: FeatureSummary): string {
  if (summary.domains.length === 0) return '系统功能全景为空（尚无已确认需求）。'
  const lines = [
    `最后更新：${summary.lastUpdated ?? '—'}`,
    `覆盖需求：${orDash(summary.coveredSlugs)}`,
  ]
  for (const domain of summary.domains) {
    lines.push('', `【${domain.name}】`)
    for (const entry of domain.entries) {
      lines.push(
        `- ${entry.name}（${entry.state}）来源：${entry.source || '—'}｜任务：${orDash(entry.taskIds)}`,
      )
    }
  }
  return lines.join('\n')
}
