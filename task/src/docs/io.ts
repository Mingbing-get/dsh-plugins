/**
 * Minimal, dependency-free file helpers for the Markdown projections.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Read a UTF-8 file, returning `undefined` when it does not exist. */
export function readTextIfExists(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** Write a UTF-8 file atomically, creating parent directories. */
export function writeTextFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid.toString()}`
  writeFileSync(temporary, content, 'utf8')
  renameSync(temporary, path)
}
