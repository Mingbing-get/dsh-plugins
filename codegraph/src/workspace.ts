import { realpath, stat } from 'node:fs/promises'
import { CodeGraphError, diagnostic } from './errors.ts'

export async function canonicalWorkspace(value: unknown): Promise<string> {
  if (typeof value !== 'string' || value.length === 0) throw new CodeGraphError(diagnostic('WORKSPACE_INVALID', 'This session has no valid workspace directory.', false))
  try {
    const root = await realpath(value)
    if (!(await stat(root)).isDirectory()) throw new Error('not a directory')
    return root
  } catch {
    throw new CodeGraphError(diagnostic('WORKSPACE_INVALID', 'The session workspace is missing or is not a directory.', false))
  }
}

export function cwdFromExec(exec: { agent?: { session?: { header?: { cwd?: unknown } } } }): unknown {
  return exec.agent?.session?.header?.cwd
}
