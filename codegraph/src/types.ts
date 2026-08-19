export type BackendMode = 'mcp' | 'cli' | 'auto'
export type RuntimeState = 'new' | 'detecting' | 'skipped' | 'checking' | 'initializing' | 'syncing' | 'connecting' | 'probing' | 'ready' | 'degraded' | 'closing' | 'closed'
export type CodeGraphErrorCode = 'CLI_NOT_FOUND' | 'PLATFORM_BUNDLE_MISSING' | 'WORKSPACE_INVALID' | 'WORKSPACE_DETECTION_FAILED' | 'INIT_TIMEOUT' | 'INIT_FAILED' | 'INDEX_UNHEALTHY' | 'SYNC_FAILED' | 'MCP_START_FAILED' | 'MCP_DISCONNECTED' | 'MCP_TOOL_UNAVAILABLE' | 'MCP_SCHEMA_MISMATCH' | 'MCP_PROBE_FAILED' | 'CONTEXT_BUILD_TIMEOUT' | 'CONTEXT_BUILD_FAILED' | 'PLUGIN_CLOSING'
export interface RuntimeDiagnostic { code: CodeGraphErrorCode; message: string; retryable: boolean }
export interface Config {
  backend: BackendMode; autoInit: 'always' | 'never'; autoSync: boolean; watch: boolean
  codeDetectionTimeoutMs: number; codeDetectionMaxEntries: number; skippedCacheTtlMs: number
  prepareTimeoutMs: number; contextBuildTimeoutMs: number; contextMaxTokens: number; toolCallTimeoutMs: number; shutdownGraceMs: number
  reconnect: { enabled: boolean; initialDelayMs: number; maxDelayMs: number; maxAttempts: number }
  telemetry: boolean; updateCheck: boolean; noDaemon: boolean
}
export interface CodeGraphStatusResult {
  state: RuntimeState; backend: 'mcp' | 'cli' | null; isCodeWorkspace: boolean | null; indexed: boolean; watching: boolean
  codegraphVersion?: string; lastReadyAt?: string; diagnostic?: RuntimeDiagnostic
}
