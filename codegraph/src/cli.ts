import { createRequire } from 'node:module'
import { access } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { CodeGraphError, diagnostic } from './errors.ts'

const require = createRequire(import.meta.url)
export function resolveCli(): string {
  try { return require.resolve('@colbymchenry/codegraph/npm-shim.js') } catch { throw new CodeGraphError(diagnostic('CLI_NOT_FOUND', 'The bundled CodeGraph CLI is missing. Reinstall this plugin.', false)) }
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
