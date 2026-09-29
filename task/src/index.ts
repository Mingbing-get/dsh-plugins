/**
 * Task orchestrator host plugin.
 *
 * 当前阶段只建立工程骨架：需求梳理、任务拆解、调度与执行均未实现。
 * 产品与功能定义见 `task/docs/products/task-orchestrator.md`。
 */
export const name = 'task-orchestrator'

/**
 * Services the finished plugin will consume.
 *
 * Declared now so the composition contract is visible: tools (`task_*` 工具)、
 * agents (拆解与任务执行会话)、userQuestions (需求澄清与确认)、
 * systemPrompt (角色与约束注入)、connection (Web 悬浮通知面板)。
 * 实现落地前不注入任何服务，因此当前为空安装。
 */
export const inject = ['tools', 'agents', 'userQuestions', 'systemPrompt', 'connection'] as const

/**
 * Install the task orchestrator.
 *
 * Intentionally empty: the implementation lands in milestones M1–M7 of the
 * product document. Registering tools, the scheduler, and the runner happens
 * once those modules exist.
 */
export function apply(): void {}
