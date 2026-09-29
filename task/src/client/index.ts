/**
 * Task orchestrator client plugin.
 *
 * 当前阶段只建立工程骨架：用于失败/阻塞任务人工介入的悬浮通知面板尚未实现。
 * 交互与展示要求见 `task/docs/products/task-orchestrator.md` 第 5.8 节。
 */
export const name = 'task-orchestrator-client'

/** No client surface is registered until the notification panel is implemented. */
export function apply(): void {}
