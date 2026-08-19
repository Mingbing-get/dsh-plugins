import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { resolveConfig } from './config.ts'
import { buildContext } from './context.ts'
import { CodeGraphError } from './errors.ts'
import { WorkspaceRuntimeManager } from './manager.ts'
import type { Config } from './types.ts'
import { canonicalWorkspace, cwdFromExec } from './workspace.ts'

export const name = 'codegraph'
export const inject = ['tools']
const output = { schema: { type: 'object', additionalProperties: true }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] } as const
type Execution = { agent?: { session?: { header?: { cwd?: unknown } } }; signal?: AbortSignal }

function textOf(message: UserMessage): string {
  return message.content.filter((block): block is { type: 'text'; text: string } => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n')
}
function toolFailure(error: unknown): { ok: false; error: { code: string; message: string } } {
  const detail = error instanceof CodeGraphError ? error.diagnostic : { code: 'CONTEXT_BUILD_FAILED', message: String(error) }
  return { ok: false, error: { code: detail.code, message: detail.message } }
}

export function apply(ctx: Context, options: Partial<Config> = {}): void {
  const config = resolveConfig(options)
  const manager = new WorkspaceRuntimeManager(config, message => ctx.logger.info(message))
  const rootFor = async (exec: Execution): Promise<string> => canonicalWorkspace(cwdFromExec(exec))
  const contextMessage = (text: string) => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'dsh-codegraph-plugin' } })

  // Runs before agent/request/provider dispatch. The original user message remains intact;
  // generated repository content is inserted as a separately labelled user context block.
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    const question = decision.messages.map(textOf).filter(Boolean).join('\n')
    if (!question) return decision
    try {
      const root = await canonicalWorkspace(payload.agent.session.header.cwd)
      const runtime = await manager.ensure(root, payload.signal)
      if (runtime.state !== 'ready') return decision
      const context = await buildContext(manager, root, question, config, payload.signal)
      return { kind: 'enter', messages: [contextMessage(context), ...decision.messages] }
    } catch (error) {
      // A CodeGraph fault deliberately does not veto the model request. Tools report the
      // stable diagnostic when explicitly invoked, while this turn safely degrades.
      if (error instanceof CodeGraphError) ctx.logger.warn(`CodeGraph degraded: ${error.diagnostic.code}`)
      return decision
    }
  })

  ctx.tools.register(defineTool({
    name: 'codegraph_explore', description: 'Query CodeGraph for task-relevant source files, symbols, callers, and impact in the current session workspace.',
    parameters: { query: { type: 'string', required: true, description: 'Natural-language coding question or task.' } }, output,
    async execute(args, exec) { try { const root = await rootFor(exec); return { ok: true, backend: manager.status(root).backend, result: await manager.query(root, 'explore', { query: args.query }, exec.signal) } } catch (error) { return toolFailure(error) } },
    presentCall: args => ({ card: 'generic', title: 'CodeGraph explore', kind: 'other', rawInput: args }),
  }))
  ctx.tools.register(defineTool({
    name: 'codegraph_node', description: 'Get CodeGraph details for a symbol or file in the current session workspace.',
    parameters: { query: { type: 'string', required: true, description: 'A symbol or file identifier.' } }, output,
    async execute(args, exec) { try { const root = await rootFor(exec); return { ok: true, backend: manager.status(root).backend, result: await manager.query(root, 'node', { query: args.query }, exec.signal) } } catch (error) { return toolFailure(error) } },
    presentCall: args => ({ card: 'generic', title: 'CodeGraph node', kind: 'other', rawInput: args }),
  }))
  ctx.tools.register(defineTool({
    name: 'codegraph_status', description: 'Show CodeGraph status for the current session workspace.', parameters: {}, output,
    async execute(_args, exec) { try { const root = await rootFor(exec); await manager.ensure(root, exec.signal); return JSON.parse(JSON.stringify(manager.status(root))) as never } catch (error) { return toolFailure(error) } },
    presentCall: () => ({ card: 'generic', title: 'CodeGraph status', kind: 'other', rawInput: {} }),
  }))
  ctx.tools.register(defineTool({
    name: 'codegraph_sync', description: 'Explicitly run a safe CodeGraph incremental sync for the current session workspace.', parameters: {}, output,
    async execute(_args, exec) { try { const root = await rootFor(exec); await manager.sync(root, exec.signal); return { ok: true, status: JSON.parse(JSON.stringify(manager.status(root))) as never } } catch (error) { return toolFailure(error) } },
    presentCall: () => ({ card: 'generic', title: 'CodeGraph sync', kind: 'other', rawInput: {} }),
  }))
  ctx.effect(() => () => manager.closeAll(), 'codegraph runtime teardown')
}
