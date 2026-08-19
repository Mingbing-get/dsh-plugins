import type { ChildProcess } from 'node:child_process'
import { CodeGraphError, diagnostic } from './errors.ts'

export class McpClient {
  private next = 1; private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: unknown): void }>()
  private buffer = ''
  constructor(private readonly child: ChildProcess) {
    child.stdout?.on('data', chunk => { this.buffer += String(chunk); const lines = this.buffer.split('\n'); this.buffer = lines.pop() ?? ''; for (const line of lines) this.receive(line) })
    child.once('exit', () => { for (const call of this.pending.values()) call.reject(new CodeGraphError(diagnostic('MCP_DISCONNECTED', 'CodeGraph MCP server disconnected.'))); this.pending.clear() })
  }
  private receive(line: string): void { try { const response = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } }; if (response.id !== undefined) { const call = this.pending.get(response.id); if (call === undefined) return; this.pending.delete(response.id); if (response.error) call.reject(new Error(response.error.message ?? 'MCP error')); else call.resolve(response.result) } } catch { /* ignore non-protocol output */ } }
  call(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const id = this.next++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new CodeGraphError(diagnostic('MCP_PROBE_FAILED', `CodeGraph MCP ${method} timed out.`))) }, timeoutMs)
      this.pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } })
      this.child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }
  async initialize(timeoutMs: number): Promise<string[]> { await this.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'dsh-codegraph-plugin', version: '0.1.0' } }, timeoutMs); const listed = await this.call('tools/list', {}, timeoutMs) as { tools?: Array<{ name?: string }> }; return (listed.tools ?? []).flatMap(tool => typeof tool.name === 'string' ? [tool.name] : []) }
  close(): void { this.child.stdin?.end() }
}
