/**
 * Small pure text helpers: slugs, ids, timestamps, and defensive truncation.
 */

const SLUG_MAX = 60

/**
 * Normalize a title into an ASCII kebab-case slug.
 *
 * Titles that contain no ASCII letters or digits (typical for Chinese titles)
 * collapse to the supplied fallback; the store appends a numeric suffix until
 * the slug is unique, so callers never need to retry themselves.
 * @param input - human title.
 * @param fallback - slug used when nothing usable remains.
 * @returns a lowercase, hyphen-separated slug.
 */
export function slugify(input: string, fallback = 'requirement'): string {
  const ascii = input.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '')
  const collapsed = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+/u, '')
    .replace(/-+$/u, '')
  const trimmed = collapsed.slice(0, SLUG_MAX).replace(/-+$/u, '')
  return trimmed.length > 0 ? trimmed : fallback
}

/** Validate an explicitly supplied slug. */
export function isSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value) && value.length <= SLUG_MAX
}

/**
 * Validate a caller-supplied slug, falling back to {@link slugify}.
 * @param candidate - optional explicit slug.
 * @param title - title used for the fallback.
 * @param fallback - fallback when the title has no ASCII content.
 * @returns the usable slug.
 */
export function resolveSlug(
  candidate: string | undefined,
  title: string,
  fallback?: string,
): string {
  if (candidate !== undefined && candidate.length > 0) return candidate
  return slugify(title, fallback)
}

/** Current time as an ISO-8601 string (UTC, second precision). */
export function nowIso(now: Date = new Date()): string {
  return now.toISOString()
}

/**
 * Collapse whitespace and clamp a string to a maximum length.
 * @param value - raw text.
 * @param max - maximum length including the ellipsis.
 * @returns the clamped single-line text.
 */
export function clamp(value: string, max = 400): string {
  const flat = value.replace(/\s+/gu, ' ').trim()
  if (flat.length <= max) return flat
  return `${flat.slice(0, Math.max(0, max - 1))}…`
}

/** Render a list as a comma-separated line, or an em dash when empty. */
export function orDash(values: readonly string[]): string {
  return values.length === 0 ? '—' : values.join('、')
}

/** Split text into trimmed, non-empty lines. */
export function nonEmptyLines(text: string): string[] {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}
