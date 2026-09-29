/**
 * Resolved plugin options.
 *
 * The plugin serves *workspaces*: the target repository is the working
 * directory of the session that calls a tool (`session.header.cwd`), not the
 * directory the DSH process happened to be launched from. These helpers turn a
 * partial config into total options and derive the per-root paths, so every
 * module agrees on where documents and the database live.
 */

import { realpathSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

/** Default location of the SQLite database, relative to each workspace root. */
export const DEFAULT_DATABASE_FILE = '.dsh/task-orchestrator.sqlite'

/** Plugin options after defaulting (always scoped to one workspace root). */
export interface TaskOrchestratorOptions {
  /** Workspace (target project repository) root this option set belongs to. */
  workspaceRoot: string
  /** Database location relative to the workspace root. */
  databaseFile: string
  /** Absolute path of the SQLite database for this workspace. */
  databasePath: string
  /** Docs directory relative to the workspace root. */
  docsRoot: string
  /** Fixed name of the system feature overview file. */
  systemFeaturesFile: string
  /** Automatic retries per task before it is marked failed. */
  maxRetries: number
  /** Backoff delays, in milliseconds, indexed by attempt. */
  retryBackoffMs: number[]
  /** Fallback scan interval in milliseconds. */
  scanIntervalMs: number
  /** Maximum clarification rounds per requirement. */
  maxClarifyRounds: number
  /** Refuse to run a task when the git worktree is dirty. */
  requireCleanWorktree: boolean
  /** Wall-clock budget for one task execution session. */
  taskTimeoutMs: number
  /** Commit message template; `{id}` and `{title}` are substituted. */
  commitMessageTemplate: string
  /** Whether the periodic fallback scan runs at all. */
  enableScheduler: boolean
}

/**
 * Partial options accepted from the plugin config.
 *
 * `workspaceRoot` is only the fallback used when a call carries no session
 * working directory; every call that has one resolves its own root.
 */
export type TaskOrchestratorConfig = Partial<TaskOrchestratorOptions>

/** Default backoff schedule for automatic retries. */
export const DEFAULT_RETRY_BACKOFF_MS = [30_000, 120_000] as const

/**
 * Canonicalize a root so one directory always maps to a single workspace.
 * @param path - workspace root candidate.
 * @returns the resolved, symlink-free absolute path.
 */
export function normalizeRoot(path: string): string {
  const absolute = resolve(path)
  try {
    return realpathSync.native(absolute)
  } catch {
    return absolute
  }
}

/**
 * Resolve partial options against the fallback workspace root.
 * @param config - partial plugin config.
 * @param cwd - fallback root used when a call carries no session directory.
 * @returns total options for that root.
 */
export function resolveOptions(
  config: TaskOrchestratorConfig = {},
  cwd: string = process.cwd(),
): TaskOrchestratorOptions {
  const workspaceRoot = normalizeRoot(config.workspaceRoot ?? cwd)
  const databaseFile = config.databaseFile ?? DEFAULT_DATABASE_FILE
  if (isAbsolute(databaseFile)) {
    throw new Error(
      `task-orchestrator: databaseFile 必须是相对于工作区根目录的路径，收到绝对路径 ${databaseFile}`,
    )
  }
  return {
    workspaceRoot,
    databaseFile,
    databasePath: resolve(workspaceRoot, databaseFile),
    docsRoot: config.docsRoot ?? 'docs',
    systemFeaturesFile: config.systemFeaturesFile ?? 'system-features.md',
    maxRetries: config.maxRetries ?? 2,
    retryBackoffMs: [...(config.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS)],
    scanIntervalMs: config.scanIntervalMs ?? 30_000,
    maxClarifyRounds: config.maxClarifyRounds ?? 8,
    requireCleanWorktree: config.requireCleanWorktree ?? true,
    taskTimeoutMs: config.taskTimeoutMs ?? 30 * 60_000,
    commitMessageTemplate: config.commitMessageTemplate ?? 'feat({id}): {title}',
    enableScheduler: config.enableScheduler ?? true,
  }
}

/**
 * Re-scope one option set onto another workspace root.
 * @param options - options resolved for some root.
 * @param root - target workspace root.
 * @returns options whose root-derived paths point at `root`.
 */
export function optionsForRoot(
  options: TaskOrchestratorOptions,
  root: string,
): TaskOrchestratorOptions {
  const workspaceRoot = normalizeRoot(root)
  if (workspaceRoot === options.workspaceRoot) return options
  return {
    ...options,
    workspaceRoot,
    databasePath: resolve(workspaceRoot, options.databaseFile),
  }
}
