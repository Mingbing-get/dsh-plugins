/**
 * Wiring contract: every surface declares the services its fiber touches.
 *
 * A cordis fiber may only read services it injects, and the failure mode is a
 * boot-time plugin-tree error. The intervention panel and the `/task` command
 * are mounted as child plugins precisely because they need capabilities the
 * core does not (`connection` + `webServer`, and `commands`).
 */

import { describe, expect, it } from 'vitest'
import { commandPlugin, inject, name, panelPlugin } from './index.ts'
import type { WorkspaceRegistry } from './workspace/registry.ts'
import type { OrchestratorLogger } from './service.ts'
import type { AgentRunner } from './agents/session.ts'

const registry = {} as unknown as WorkspaceRegistry
const logger: OrchestratorLogger = { info: () => {}, warn: () => {}, error: () => {} }
const agents: AgentRunner = { run: () => Promise.reject(new Error('unused')) }

describe('plugin wiring', () => {
  it('injects exactly the services the plugin body reads', () => {
    expect(name).toBe('task-orchestrator')
    expect([...inject].sort()).toEqual(['agents', 'systemPrompt', 'tools', 'userQuestions'])
  })

  it('scopes the panel to connection + webServer', () => {
    // Current DSH registers the channel's physical route on the calling fiber's
    // web server; the installer falls back to `/api` Fetch routes where that
    // mechanism cannot work (see the boot wiring test).
    const plugin = panelPlugin(registry, logger)
    expect(plugin.name).toBe('task-orchestrator:panel')
    expect([...plugin.inject].sort()).toEqual(['connection', 'webServer'])
    expect(plugin.apply).toBeTypeOf('function')
  })

  it('scopes the command surface to commands', () => {
    const plugin = commandPlugin({ registry, agents, logger })
    expect(plugin.name).toBe('task-orchestrator:command')
    expect(plugin.inject).toEqual(['commands'])
    expect(plugin.apply).toBeTypeOf('function')
  })

  it('does not require capabilities the core can do without', () => {
    // These belong to the child plugins so a profile without a web server or a
    // command adapter still loads the tools and the scheduler.
    for (const optional of ['connection', 'webServer', 'commands']) {
      expect([...inject]).not.toContain(optional)
    }
  })
})
