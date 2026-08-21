import { existsSync } from 'node:fs'
import type { ChildProcess } from 'node:child_process'
import { command, cliEnv, resolveCli, startServer } from './cli.ts'
import { detectCodeWorkspace } from './detector.ts'
import { CodeGraphError, diagnostic } from './errors.ts'
import { McpClient } from './mcp.ts'
import type { CodeGraphStatusResult, Config, RuntimeDiagnostic, RuntimeState } from './types.ts'

interface Runtime {
  root: string
  state: RuntimeState
  code: boolean | null
  indexed: boolean
  backend: 'mcp' | 'cli' | null
  watching: boolean
  prepare?: Promise<void> | undefined
  mutation: Promise<void>
  client?: McpClient | undefined
  child?: ChildProcess | undefined
  lastError?: RuntimeDiagnostic
  lastReadyAt?: string
  skippedAt?: number
}
const contentOf = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const v = value as { content?: Array<{ type?: string; text?: string }> }
    if (Array.isArray(v.content))
      return v.content
        .filter((x) => x.type === 'text' && typeof x.text === 'string')
        .map((x) => x.text)
        .join('\n')
  }
  return JSON.stringify(value)
}

export class WorkspaceRuntimeManager {
  private readonly runtimes = new Map<string, Runtime>()
  private closing = false
  constructor(
    private readonly config: Config,
    private readonly log: (message: string) => void = () => {},
  ) {}
  private runtime(root: string): Runtime {
    let value = this.runtimes.get(root)
    if (!value) {
      value = {
        root,
        state: 'new',
        code: null,
        indexed: false,
        backend: null,
        watching: false,
        mutation: Promise.resolve(),
      }
      this.runtimes.set(root, value)
    }
    return value
  }
  private transition(runtime: Runtime, state: RuntimeState): void {
    runtime.state = state
    this.log(`CodeGraph ${state} (${this.label(runtime.root)})`)
  }
  private label(root: string): string {
    let h = 0
    for (const c of root) h = (h * 31 + c.charCodeAt(0)) | 0
    return (h >>> 0).toString(16)
  }
  private fail(runtime: Runtime, error: unknown, fallback: RuntimeDiagnostic): never {
    const detail = error instanceof CodeGraphError ? error.diagnostic : fallback
    runtime.lastError = detail
    runtime.backend = null
    runtime.watching = false
    this.transition(runtime, 'degraded')
    throw new CodeGraphError(detail)
  }
  async ensure(root: string, signal?: AbortSignal): Promise<Runtime> {
    if (this.closing)
      throw new CodeGraphError(
        diagnostic('PLUGIN_CLOSING', 'The CodeGraph plugin is closing.', false),
      )
    const runtime = this.runtime(root)
    if (runtime.state === 'ready') return runtime
    if (
      runtime.state === 'skipped' &&
      runtime.skippedAt &&
      Date.now() - runtime.skippedAt < this.config.skippedCacheTtlMs
    )
      return runtime
    if (!runtime.prepare)
      runtime.prepare = this.prepare(runtime, signal).finally(() => {
        runtime.prepare = undefined
      })
    await runtime.prepare
    return runtime
  }
  private async prepare(runtime: Runtime, signal?: AbortSignal): Promise<void> {
    this.transition(runtime, 'detecting')
    try {
      const detected = await detectCodeWorkspace(runtime.root, this.config)
      runtime.code = detected.code
      if (!detected.code) {
        runtime.skippedAt = Date.now()
        runtime.indexed = false
        runtime.backend = null
        this.transition(runtime, 'skipped')
        return
      }
      const cli = resolveCli()
      const env = cliEnv(this.config.watch)
      this.transition(runtime, 'checking')
      const hasIndex = existsSync(`${runtime.root}/.codegraph`)
      if (!hasIndex) {
        if (this.config.autoInit === 'never')
          this.fail(
            runtime,
            new Error(),
            diagnostic(
              'INDEX_UNHEALTHY',
              'No CodeGraph index exists and auto initialization is disabled.',
              false,
            ),
          )
        this.transition(runtime, 'initializing')
        const init = await command(
          cli,
          ['init'],
          runtime.root,
          env,
          this.config.prepareTimeoutMs,
          signal,
        )
        if (init.code !== 0)
          this.fail(
            runtime,
            new Error(),
            diagnostic(
              'INIT_FAILED',
              'CodeGraph initialization failed. Check the workspace and plugin installation.',
            ),
          )
      } else if (this.config.autoSync) {
        this.transition(runtime, 'syncing')
        const sync = await command(
          cli,
          ['sync'],
          runtime.root,
          env,
          this.config.prepareTimeoutMs,
          signal,
        )
        if (sync.code !== 0)
          this.fail(
            runtime,
            new Error(),
            diagnostic('SYNC_FAILED', 'CodeGraph incremental sync failed.'),
          )
      }
      // Directory presence is not a health signal. The CLI must be able to inspect
      // the completed index before a watcher or query transport is allowed to use it.
      const status = await command(
        cli,
        ['status'],
        runtime.root,
        env,
        this.config.toolCallTimeoutMs,
        signal,
      )
      if (status.code !== 0)
        this.fail(
          runtime,
          new Error(),
          diagnostic(
            'INDEX_UNHEALTHY',
            'CodeGraph reported an unusable index; it was not rebuilt automatically.',
          ),
        )
      runtime.indexed = true
      if (this.config.backend === 'cli') {
        runtime.backend = 'cli'
        runtime.watching = false
        runtime.lastReadyAt = new Date().toISOString()
        this.transition(runtime, 'ready')
        return
      }
      this.transition(runtime, 'connecting')
      runtime.child = startServer(cli, runtime.root, env)
      runtime.client = new McpClient(runtime.child)
      const tools = await runtime.client.initialize(this.config.toolCallTimeoutMs)
      const contextTool = tools.includes('codegraph_context')
        ? 'codegraph_context'
        : tools.includes('codegraph_explore')
          ? 'codegraph_explore'
          : undefined
      if (!contextTool)
        this.fail(
          runtime,
          new Error(),
          diagnostic(
            'MCP_TOOL_UNAVAILABLE',
            'The locked CodeGraph MCP context tool is unavailable.',
          ),
        )
      this.transition(runtime, 'probing')
      await runtime.client.call(
        'tools/call',
        { name: contextTool, arguments: { query: 'CodeGraph health probe' } },
        this.config.toolCallTimeoutMs,
      )
      runtime.backend = 'mcp'
      runtime.watching = this.config.watch
      runtime.lastReadyAt = new Date().toISOString()
      this.transition(runtime, 'ready')
    } catch (error) {
      this.fail(runtime, error, diagnostic('MCP_START_FAILED', 'CodeGraph could not be prepared.'))
    }
  }
  async query(
    root: string,
    operation: 'explore' | 'node',
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<string> {
    const runtime = await this.ensure(root, signal)
    if (runtime.state !== 'ready')
      throw new CodeGraphError(diagnostic('MCP_DISCONNECTED', 'CodeGraph is not ready.'))
    if (runtime.backend === 'mcp' && runtime.client) {
      const names =
        operation === 'explore' ? ['codegraph_context', 'codegraph_explore'] : ['codegraph_node']
      let last: unknown
      for (const name of names)
        try {
          return contentOf(
            await runtime.client.call(
              'tools/call',
              { name, arguments: args },
              this.config.toolCallTimeoutMs,
            ),
          )
        } catch (error) {
          last = error
        }
      throw new CodeGraphError(
        diagnostic(
          'MCP_TOOL_UNAVAILABLE',
          `CodeGraph ${operation} is unavailable: ${String(last)}`,
        ),
      )
    }
    const cli = resolveCli()
    const result = await command(
      cli,
      [operation, String(args.query ?? '')],
      root,
      cliEnv(false),
      this.config.toolCallTimeoutMs,
      signal,
    )
    if (result.code !== 0)
      throw new CodeGraphError(
        diagnostic('CONTEXT_BUILD_FAILED', `CodeGraph CLI ${operation} failed.`),
      )
    return result.stdout
  }
  async sync(root: string, signal?: AbortSignal): Promise<void> {
    const runtime = this.runtime(root)
    await this.closeTransport(runtime)
    runtime.state = 'new'
    await this.ensure(root, signal)
  }
  status(root: string): CodeGraphStatusResult {
    const r = this.runtime(root)
    return {
      state: r.state,
      backend: r.backend,
      isCodeWorkspace: r.code,
      indexed: r.indexed,
      watching: r.watching,
      ...(r.lastReadyAt ? { lastReadyAt: r.lastReadyAt } : {}),
      ...(r.lastError ? { diagnostic: r.lastError } : {}),
    }
  }
  private async closeTransport(runtime: Runtime): Promise<void> {
    runtime.client?.close()
    runtime.client = undefined
    const child = runtime.child
    runtime.child = undefined
    runtime.watching = false
    if (!child || child.exitCode !== null) return
    child.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, this.config.shutdownGraceMs)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }
  async closeAll(): Promise<void> {
    this.closing = true
    await Promise.all(
      [...this.runtimes.values()].map(async (runtime) => {
        this.transition(runtime, 'closing')
        await this.closeTransport(runtime)
        this.transition(runtime, 'closed')
      }),
    )
    this.runtimes.clear()
  }
}
