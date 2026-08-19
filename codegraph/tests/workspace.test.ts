import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import { detectCodeWorkspace } from '../src/detector.ts'
import { CodeGraphError } from '../src/errors.ts'
import { canonicalWorkspace } from '../src/workspace.ts'

const created: string[] = []
async function workspace(): Promise<string> { const root = await mkdtemp(join(tmpdir(), 'dsh-codegraph-')); created.push(root); return root }
afterEach(async () => { await Promise.all(created.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('workspace detection', () => {
  it('recognizes supported source while ignoring dependency trees', async () => {
    const root = await workspace(); await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true }); await writeFile(join(root, 'node_modules', 'pkg', 'index.ts'), 'export {}')
    expect((await detectCodeWorkspace(root, resolveConfig())).code).toBe(false)
    await writeFile(join(root, 'app.ts'), 'export const answer = 42')
    expect((await detectCodeWorkspace(root, resolveConfig())).code).toBe(true)
  })
  it('never treats documents and manifests as source', async () => {
    const root = await workspace(); await writeFile(join(root, 'README.md'), '# docs'); await writeFile(join(root, 'package.json'), '{}')
    expect((await detectCodeWorkspace(root, resolveConfig())).code).toBe(false)
  })
  it('respects root gitignore rules before deciding to index', async () => {
    const root = await workspace(); await writeFile(join(root, '.gitignore'), 'generated/\n'); await mkdir(join(root, 'generated'), { recursive: true }); await writeFile(join(root, 'generated', 'api.ts'), 'export {}')
    expect((await detectCodeWorkspace(root, resolveConfig())).code).toBe(false)
  })
  it('rejects absent workspace roots', async () => {
    await expect(canonicalWorkspace('/this/path/does/not/exist')).rejects.toBeInstanceOf(CodeGraphError)
  })
})
