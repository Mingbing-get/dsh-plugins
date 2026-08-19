import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { CodeGraphError, diagnostic } from './errors.ts'

const require = createRequire(import.meta.url)
export function resolveCli(): string {
  try {
    // The upstream package deliberately exports only its package manifest and
    // SDK entry point. Resolving `npm-shim.js` as a package subpath therefore
    // fails with ERR_PACKAGE_PATH_NOT_EXPORTED even when the CLI is installed.
    // Locate the exported manifest first, then resolve the shipped shim by its
    // filesystem path.
    const manifest = require.resolve('@colbymchenry/codegraph/package.json')
    const shim = join(dirname(manifest), 'npm-shim.js')
    if (!existsSync(shim)) throw new Error('npm-shim.js is absent')
    return shim
  } catch {
    throw new CodeGraphError(diagnostic('CLI_NOT_FOUND', 'The bundled CodeGraph CLI is missing. Reinstall this plugin.', false))
  }
}
export interface CommandResult { stdout: string; stderr: string; code: number }
export function command(cli: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number, signal?: AbortSignal): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''; let stderr = ''; const cap = 1_000_000
    const consume = (target: 'stdout' | 'stderr', chunk: Buffer) => { const next = (target === 'stdout' ? stdout : stderr) + chunk.toString(); if (target === 'stdout') stdout = next.slice(0, cap); else stderr = next.slice(0, cap) }
    child.stdout?.on('data', (c: Buffer) => consume('stdout', c)); child.stderr?.on('data', (c: Buffer) => consume('stderr', c))
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new CodeGraphError(diagnostic('INIT_TIMEOUT', 'CodeGraph operation timed out.')))}, timeoutMs)
    const abort = () => { child.kill('SIGTERM'); reject(signal?.reason ?? new Error('operation cancelled')) }
    signal?.addEventListener('abort', abort, { once: true })
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('close', code => { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve({ stdout, stderr, code: code ?? -1 }) })
  })
}
export function cliEnv(watch: boolean): NodeJS.ProcessEnv { return { PATH: process.env.PATH, HOME: process.env.HOME, CODEGRAPH_TELEMETRY: '0', CODEGRAPH_NO_UPDATE_CHECK: '1', CODEGRAPH_NO_DAEMON: '1', ...(watch ? {} : { CODEGRAPH_NO_WATCH: '1' }) } }
export function startServer(cli: string, root: string, env: NodeJS.ProcessEnv): ChildProcess { return spawn(process.execPath, [cli, 'serve', '--mcp', '--path', root], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] }) }
