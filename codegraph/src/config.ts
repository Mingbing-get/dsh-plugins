import type { Config } from './types.ts'
export const defaults: Config = {
  backend: 'auto', autoInit: 'always', autoSync: true, watch: true, codeDetectionTimeoutMs: 5_000,
  codeDetectionMaxEntries: 10_000, skippedCacheTtlMs: 30_000, prepareTimeoutMs: 300_000,
  contextBuildTimeoutMs: 60_000, contextMaxTokens: 12_000, toolCallTimeoutMs: 60_000,
  shutdownGraceMs: 5_000, reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 10_000, maxAttempts: 3 },
  telemetry: false, updateCheck: false, noDaemon: true,
}
export function resolveConfig(value: Partial<Config> = {}): Config {
  return { ...defaults, ...value, reconnect: { ...defaults.reconnect, ...value.reconnect } }
}
