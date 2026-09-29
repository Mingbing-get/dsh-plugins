/**
 * Git operations the orchestrator needs: repository detection, worktree
 * hygiene, staging, and one-commit-per-task submission.
 */

import { execFile } from 'node:child_process'

/** Result of one git invocation. */
export interface GitResult {
  ok: boolean
  code: number
  stdout: string
  stderr: string
}

/** Outcome of a submission attempt. */
export type CommitOutcome = { ok: true; hash: string } | { ok: false; message: string }

function runProcess(
  cwd: string,
  binary: string,
  args: readonly string[],
  trim = true,
): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(binary, [...args], { cwd, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1
      resolve({
        ok: error === null,
        code,
        stdout: trim ? stdout.trim() : stdout,
        stderr: stderr.trim(),
      })
    })
  })
}

function run(cwd: string, args: readonly string[], trim = true): Promise<GitResult> {
  return runProcess(cwd, 'git', args, trim)
}

/** Thin wrapper over the `git` CLI scoped to one repository. */
export class GitClient {
  /** Absolute repository root. */
  readonly root: string

  constructor(root: string) {
    this.root = root
  }

  /**
   * Run one git command.
   * @param args - git arguments.
   * @param trim - whether to trim stdout (porcelain output must stay verbatim:
   * trimming eats the leading status column of the first line).
   */
  exec(args: readonly string[], trim = true): Promise<GitResult> {
    return run(this.root, args, trim)
  }

  /** Whether the directory is inside a git work tree. */
  async isRepository(): Promise<boolean> {
    const result = await this.exec(['rev-parse', '--is-inside-work-tree'])
    return result.ok && result.stdout === 'true'
  }

  /** Current branch name, or `null` when detached/unavailable. */
  async currentBranch(): Promise<string | null> {
    const result = await this.exec(['rev-parse', '--abbrev-ref', 'HEAD'])
    if (!result.ok) return null
    return result.stdout.length > 0 ? result.stdout : null
  }

  /** HEAD commit hash, or `null` on an unborn branch. */
  async head(): Promise<string | null> {
    const result = await this.exec(['rev-parse', 'HEAD'])
    return result.ok ? result.stdout : null
  }

  /** Porcelain status output (empty when the worktree is clean). */
  async status(): Promise<string> {
    const result = await this.exec(['status', '--porcelain'], false)
    return result.ok ? result.stdout : ''
  }

  /** Whether the worktree has no pending changes. */
  async isClean(): Promise<boolean> {
    return (await this.status()).length === 0
  }

  /** Paths with uncommitted changes (rename targets reduced to their new path). */
  async changedPaths(): Promise<string[]> {
    // Porcelain format is `XY <path>`; the two status columns are fixed-width,
    // so the path starts at index 3 on every line.
    const result = await this.exec(['status', '--porcelain'], false)
    if (!result.ok) return []
    return result.stdout
      .split('\n')
      .filter((line) => line.length > 3)
      .map((line) => {
        const path = line.slice(3).trim()
        const arrow = path.lastIndexOf(' -> ')
        return arrow === -1 ? path : path.slice(arrow + 4)
      })
      .filter((line) => line.length > 0)
  }

  /**
   * Stage the given paths (or everything when `paths` is empty) and commit.
   * @param message - commit message.
   * @param paths - workspace-relative paths, or `[]` for `git add -A`.
   * @returns the new commit hash, or the failure message.
   */
  async commit(message: string, paths: readonly string[] = []): Promise<CommitOutcome> {
    if (!(await this.isRepository())) {
      return { ok: false, message: `${this.root} 不是一个 git 仓库` }
    }
    const add = paths.length === 0 ? ['add', '-A'] : ['add', '--', ...paths]
    const staged = await this.exec(add)
    if (!staged.ok) return { ok: false, message: `git add 失败：${staged.stderr || staged.stdout}` }
    const status = await this.exec(['diff', '--cached', '--name-only'])
    if (status.ok && status.stdout.length === 0) {
      return { ok: false, message: '没有可提交的内容（工作区无变化）' }
    }
    const commit = await this.exec(['commit', '-m', message])
    if (!commit.ok)
      return { ok: false, message: `git commit 失败：${commit.stderr || commit.stdout}` }
    const head = await this.head()
    if (head === null) return { ok: false, message: 'git commit 成功但无法读取 HEAD' }
    return { ok: true, hash: head }
  }

  /**
   * Run a verification command declared by a task document. The command is
   * executed without a shell, so pipes and redirection are not interpreted.
   * @param command - command line, split on whitespace.
   * @param timeoutMs - wall-clock budget before the command is killed.
   * @returns the command result.
   */
  verify(command: string, timeoutMs = 10 * 60_000): Promise<GitResult> {
    const [binary, ...args] = command.split(/\s+/u)
    if (binary === undefined) {
      return Promise.resolve({ ok: false, code: 1, stdout: '', stderr: '空命令' })
    }
    return new Promise((resolve) => {
      execFile(
        binary,
        args,
        { cwd: this.root, maxBuffer: 8 * 1024 * 1024, timeout: timeoutMs },
        (error, stdout, stderr) => {
          const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1
          resolve({ ok: error === null, code, stdout: stdout.trim(), stderr: stderr.trim() })
        },
      )
    })
  }

  /**
   * Fold the currently staged changes into the previous commit. Used when the
   * executor committed on its own and the orchestrator still has to add the
   * document/status updates to the same task commit.
   * @param message - replacement commit message.
   * @returns the amended commit hash, or the failure message.
   */
  async amendCommit(message: string): Promise<CommitOutcome> {
    const result = await this.exec(['commit', '--amend', '-m', message])
    if (!result.ok)
      return { ok: false, message: `git commit --amend 失败：${result.stderr || result.stdout}` }
    const head = await this.head()
    if (head === null) return { ok: false, message: 'amend 成功但无法读取 HEAD' }
    return { ok: true, hash: head }
  }

  /** Commit subject line of one hash. */
  async subject(hash: string): Promise<string | null> {
    const result = await this.exec(['log', '-1', '--pretty=%s', hash])
    return result.ok && result.stdout.length > 0 ? result.stdout : null
  }
}
