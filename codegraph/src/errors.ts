import type { CodeGraphErrorCode, RuntimeDiagnostic } from './types.ts'
export class CodeGraphError extends Error {
  constructor(readonly diagnostic: RuntimeDiagnostic) { super(diagnostic.message); this.name = 'CodeGraphError' }
}
export function diagnostic(code: CodeGraphErrorCode, message: string, retryable = true): RuntimeDiagnostic { return { code, message, retryable } }
