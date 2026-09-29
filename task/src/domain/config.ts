/**
 * Resolved plugin options.
 *
 * The plugin serves *workspaces*: the target repository is the working
 * directory of the session that calls a tool (`session.header.cwd`), not the
 * directory the DSH process happened to be launched from. These helpers turn a
 * partial config into total options and derive the per-root paths, so every
 * module agrees on where documents and the database live.
 *
 * Two kinds of state are deliberately kept apart:
 * - **Documents** are deliverables of the target repository
 *   (`docs/products/...`, `docs/tasks/...`) and are committed with the code.
 * - **Runtime state** is the plugin's own bookkeeping (the SQLite database,
 *   one file per workspace). It belongs to the plugin, so it lives under the
 *   harness home (`$DSH_HOME/storages/task-orchestrator/`) and never inside the
 *   user's working tree: a repository stays clean, `git status` never sees a
 *   `.dsh/` directory, and deleting a checkout cannot destroy the task log.
 */

import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { dshHomePath, expandHomePath } from '@deepseek-ai/dsh-home-paths'

/** Plugin options after defaulting (always scoped to one workspace root). */
export interface TaskOrchestratorOptions {
  /** Workspace (target project repository) root this option set belongs to. */
  workspaceRoot: string
  /** Absolute directory holding this plugin's runtime state. */
  stateDir: string
  /**
   * Configured database file name, shared by every workspace.
   *
   * `undefined` (the default) means one database per workspace, named by
   * {@link databaseFileName}; the database always lives inside `stateDir`.
   */
  databaseFile?: string
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
  /**
   * Surface every orchestrator session (task execution and decomposition) as an
   * ordinary conversation in the user's session list (see `agents/session.ts`).
   * Those sessions are then visible and streamable in the Web frontend, listed
   * under the workspace owning the repository they run against.
   */
  exposeOrchestratorSessions: boolean
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

/** Path segments of the default state directory under the harness home. */
export const DEFAULT_STATE_DIR_SEGMENTS = ['storages', 'task-orchestrator'] as const

/**
 * Directory holding plugin runtime state when the config sets no `stateDir`.
 * @returns the absolute `$DSH_HOME/storages/task-orchestrator` path.
 */
export function defaultStateDir(): string {
  return dshHomePath(...DEFAULT_STATE_DIR_SEGMENTS)
}

/**
 * Stable database file name for one workspace.
 *
 * The readable slug makes the file obvious in a directory listing; the hash of
 * the canonical root keeps two checkouts that share a directory name (or two
 * worktrees of one repository) from ever sharing a database.
 * @param root - normalized workspace root.
 * @returns `<slug>-<hash12>.sqlite`.
 */
export function databaseFileName(root: string): string {
  const raw = basename(root).replace(/[^A-Za-z0-9._-]+/gu, '-')
  const slug = raw.replace(/^[-._]+|[-._]+$/gu, '').slice(0, 48)
  const hash = createHash('sha256').update(root).digest('hex').slice(0, 12)
  return `${slug.length > 0 ? slug : 'workspace'}-${hash}.sqlite`
}

/**
 * Absolute database path for one workspace.
 * @param stateDir - absolute state directory.
 * @param databaseFile - configured file name, or `undefined` for the default.
 * @param workspaceRoot - normalized workspace root.
 * @returns the absolute path of this workspace's SQLite database.
 */
export function databasePathFor(
  stateDir: string,
  databaseFile: string | undefined,
  workspaceRoot: string,
): string {
  return join(stateDir, resolveDatabaseFile(databaseFile) ?? databaseFileName(workspaceRoot))
}

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
 * Validate the configured state directory.
 * @param configured - configured `stateDir`, if any.
 * @returns the absolute state directory.
 */
function resolveStateDir(configured: string | undefined): string {
  const value = configured?.trim()
  if (value === undefined || value.length === 0) return normalizeRoot(defaultStateDir())
  const expanded = expandHomePath(value)
  if (!isAbsolute(expanded)) {
    throw new Error(
      `task-orchestrator: stateDir 必须是绝对路径或以 ~ 开头（运行时状态不能放在工作区里），收到 ${configured}`,
    )
  }
  return normalizeRoot(expanded)
}

/**
 * Validate the configured database file name.
 * @param configured - configured `databaseFile`, if any.
 * @returns the bare file name, or `undefined` for the per-workspace default.
 */
function resolveDatabaseFile(configured: string | undefined): string | undefined {
  const value = configured?.trim()
  if (value === undefined || value.length === 0) return undefined
  if (value.includes('/') || value.includes('\\') || value === '.' || value === '..') {
    throw new Error(
      `task-orchestrator: databaseFile 只能是文件名（不能含路径分隔符），数据库目录请改用 stateDir 配置；收到 ${configured}`,
    )
  }
  return value
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
  const stateDir = resolveStateDir(config.stateDir)
  const databaseFile = resolveDatabaseFile(config.databaseFile)
  return {
    workspaceRoot,
    stateDir,
    ...(databaseFile === undefined ? {} : { databaseFile }),
    databasePath: databasePathFor(stateDir, databaseFile, workspaceRoot),
    docsRoot: config.docsRoot ?? 'docs',
    systemFeaturesFile: config.systemFeaturesFile ?? 'system-features.md',
    maxRetries: config.maxRetries ?? 2,
    retryBackoffMs: [...(config.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS)],
    scanIntervalMs: config.scanIntervalMs ?? 30_000,
    maxClarifyRounds: config.maxClarifyRounds ?? 8,
    requireCleanWorktree: config.requireCleanWorktree ?? true,
    taskTimeoutMs: config.taskTimeoutMs ?? 30 * 60_000,
    commitMessageTemplate: config.commitMessageTemplate ?? 'feat({id}): {title}',
    exposeOrchestratorSessions: config.exposeOrchestratorSessions ?? true,
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
  // The state directory is shared, but the default database name is derived
  // from the root, so it must be recomputed here.
  return {
    ...options,
    workspaceRoot,
    databasePath: databasePathFor(options.stateDir, options.databaseFile, workspaceRoot),
  }
}
