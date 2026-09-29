/**
 * Document path resolution for the *target project* repository. Every path the
 * plugin writes is derived here and validated to stay inside the workspace, so
 * a model-supplied slug can never escape the docs tree.
 */

import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { DomainError } from '../domain/errors.ts'

/** Guard against path traversal outside the owning directory. */
function assertInside(root: string, candidate: string): string {
  const normalizedRoot = resolve(root)
  const normalized = resolve(candidate)
  const rel = relative(normalizedRoot, normalized)
  if (rel.length === 0 || rel.startsWith('..') || isAbsolute(rel)) {
    throw new DomainError('path-escape', `文档路径必须位于 ${normalizedRoot} 内：${candidate}`, {
      root: normalizedRoot,
      candidate,
    })
  }
  return normalized
}

/** Resolver for every document the plugin reads or writes. */
export class DocPaths {
  /** Workspace (target repository) root. */
  readonly workspaceRoot: string

  private readonly docsRoot: string
  private readonly featuresFile: string

  /**
   * @param workspaceRoot - absolute workspace root.
   * @param docsRoot - docs directory relative to the root (default `docs`).
   * @param featuresFile - fixed file name of the system feature overview.
   */
  constructor(workspaceRoot: string, docsRoot = 'docs', featuresFile = 'system-features.md') {
    this.workspaceRoot = resolve(workspaceRoot)
    this.docsRoot = normalize(docsRoot).replace(/^\.\//u, '')
    this.featuresFile = featuresFile
  }

  /** Absolute products directory. */
  get productsDir(): string {
    return assertInside(this.workspaceRoot, join(this.workspaceRoot, this.docsRoot, 'products'))
  }

  /** Absolute tasks directory. */
  get tasksDir(): string {
    return assertInside(this.workspaceRoot, join(this.workspaceRoot, this.docsRoot, 'tasks'))
  }

  /** Absolute path of the system feature overview. */
  get systemFeaturesPath(): string {
    return assertInside(
      this.workspaceRoot,
      join(this.workspaceRoot, this.docsRoot, 'products', this.featuresFile),
    )
  }

  /**
   * Path of one requirement document.
   * @param slug - requirement slug.
   */
  productDoc(slug: string): string {
    return assertInside(this.productsDir, join(this.productsDir, `${slug}.md`))
  }

  /**
   * Path of one task document (`<task-id>-<slug>.md`).
   * @param taskId - stable task id such as `T3`.
   * @param slug - task slug.
   */
  taskDoc(taskId: string, slug: string): string {
    return assertInside(this.tasksDir, join(this.tasksDir, `${taskId}-${slug}.md`))
  }

  /** Render a path relative to the workspace root (forward slashes). */
  toRelative(absolute: string): string {
    return relative(this.workspaceRoot, absolute).split(sep).join('/')
  }
}
