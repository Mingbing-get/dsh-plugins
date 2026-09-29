/**
 * Domain errors. Every failure a tool can hand back to the model is one of
 * these, so the message stays actionable and the kind stays machine-readable.
 */

/** Stable machine-readable failure classes. */
export type DomainErrorCode =
  | 'invalid-argument'
  | 'illegal-transition'
  | 'conflict'
  | 'cycle'
  | 'not-found'
  | 'git'
  | 'path-escape'
  | 'not-confirmed'
  | 'round-limit'
  | 'unavailable'

/** Error carrying a stable code and optional structured details. */
export class DomainError extends Error {
  readonly code: DomainErrorCode
  readonly details: Record<string, unknown>

  constructor(code: DomainErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'DomainError'
    this.code = code
    this.details = details
  }
}

/** Build an `invalid-argument` error. */
export function invalidArgument(
  message: string,
  details: Record<string, unknown> = {},
): DomainError {
  return new DomainError('invalid-argument', message, details)
}

/** Build a `not-found` error. */
export function notFound(message: string, details: Record<string, unknown> = {}): DomainError {
  return new DomainError('not-found', message, details)
}

/** Build an `illegal-transition` error. */
export function illegalTransition(
  message: string,
  details: Record<string, unknown> = {},
): DomainError {
  return new DomainError('illegal-transition', message, details)
}

/** Type guard for {@link DomainError}. */
export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError
}

/** Render any thrown value as a single actionable line. */
export function describeError(value: unknown): string {
  if (value instanceof Error) return value.message
  return String(value)
}
