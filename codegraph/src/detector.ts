import { opendir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { Config } from './types.ts'
import { CodeGraphError, diagnostic } from './errors.ts'

const SOURCE = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.rb',
  '.php',
  '.swift',
  '.scala',
  '.sh',
  '.sql',
  '.vue',
  '.svelte',
])
const SKIP = new Set([
  '.git',
  '.codegraph',
  'node_modules',
  'vendor',
  'dist',
  'build',
  'coverage',
  '.next',
  '.cache',
  '.turbo',
  'target',
  '__pycache__',
])

export interface Detection {
  code: boolean
  fingerprint: string
}
export async function detectCodeWorkspace(root: string, config: Config): Promise<Detection> {
  const deadline = Date.now() + config.codeDetectionTimeoutMs
  const ignored = await readGitignore(root)
  let entries = 0
  let newest = 0
  const queue = [root]
  while (queue.length) {
    if (Date.now() > deadline || entries >= config.codeDetectionMaxEntries)
      throw new CodeGraphError(
        diagnostic(
          'WORKSPACE_DETECTION_FAILED',
          'Workspace code detection exceeded its configured limit. Try again or increase the limit.',
        ),
      )
    const directory = queue.pop()!
    let handle
    try {
      handle = await opendir(directory)
    } catch {
      continue
    }
    for await (const entry of handle) {
      entries++
      if (entries >= config.codeDetectionMaxEntries)
        throw new CodeGraphError(
          diagnostic(
            'WORKSPACE_DETECTION_FAILED',
            'Workspace code detection exceeded its configured entry limit.',
          ),
        )
      const path = join(directory, entry.name)
      const relativePath = relative(root, path)
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name) && !ignored(relativePath, true)) queue.push(path)
        continue
      }
      if (!entry.isFile()) continue
      if (ignored(relativePath, false)) continue
      try {
        newest = Math.max(newest, (await stat(path)).mtimeMs)
      } catch {
        /* files may disappear */
      }
      const dot = entry.name.lastIndexOf('.')
      if (dot >= 0 && SOURCE.has(entry.name.slice(dot).toLowerCase()))
        return { code: true, fingerprint: `${entries}:${Math.floor(newest)}` }
    }
  }
  return { code: false, fingerprint: `${entries}:${Math.floor(newest)}:${relative(root, root)}` }
}

/** Small, conservative root .gitignore matcher; unsupported negation patterns are
 * deliberately not treated as ignored so a code workspace cannot be skipped by guesswork. */
async function readGitignore(root: string): Promise<(path: string, directory: boolean) => boolean> {
  const contents = await readFile(join(root, '.gitignore'), 'utf8').catch(() => null)
  if (contents === null) return () => false
  const lines = contents.split(/\r?\n/)
  const rules = lines
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('!'))
  return (path, directory) =>
    rules.some((rule) => {
      const normalized = rule.replace(/^\//, '').replace(/\/$/, '')
      if (!normalized || (rule.endsWith('/') && !directory)) return false
      if (normalized.includes('*')) {
        const expression = new RegExp(
          `^${normalized
            .split('*')
            .map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, '\\$&'))
            .join('.*')}(?:/|$)`,
        )
        return expression.test(path)
      }
      return normalized.includes('/')
        ? path === normalized || path.startsWith(`${normalized}/`)
        : path.split('/').includes(normalized)
    })
}
