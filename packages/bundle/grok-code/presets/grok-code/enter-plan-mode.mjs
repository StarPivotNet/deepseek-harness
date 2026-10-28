/**
 * Model-facing enter tool for session plan mode.
 *
 * Official `@deepseek-ai/dsh-plan-mode` (0.1.5-rc.1) only registers
 * `exit_plan_mode` and `/plan`. This sibling lives in the same `planMode`
 * isolate so it can call `ctx.planMode.set(agent, true)` — the same API
 * `/plan` uses. It publishes no service.
 *
 * `exit_plan_mode` is a user review gate (Approve / Keep planning), not an
 * auto-implement switch. Tool copy here and `plan:policy` in agent.cordis.yml
 * must say that: stay until the result reports approved; Keep planning or a
 * dismissed review means revise and present again.
 */
export const name = 'enter-plan-mode'
export const inject = ['tools', 'planMode']

const ENTER_PLAN_MODE = 'enter_plan_mode'

const ENTER_DESCRIPTION =
  'Enter session plan mode for this agent. Use when the user asks to plan, design, or produce a spec before edits (including "plan first" / "先规划" / "do not implement yet"). Do not wait for /plan. After this returns, stay in plan mode: explore and ask. Dispatch read-only exploration subagents; do not mutate files or start AgentTeams / write-capable children until exit_plan_mode reports approved. Do not call exit_plan_mode just because you drafted a plan. When planning is actually finished, call exit_plan_mode with the complete markdown plan — that presents a user review (Approve / Keep planning) and does not implement. Stay in plan mode until the tool result reports approved. Keep planning or a dismissed review: stay, revise, present again. After approved, the next step implements (AgentTeams only for multi-file / parallel / durable / quality-gate work; do not start AgentTeams for one-file or this-turn-only work). If plan mode is already active, this is a no-op — stay there.'

function messageFor(outcome) {
  if (outcome === 'noop' || outcome === 'cancelled') {
    return 'Plan mode is already active. Stay in plan mode: explore, ask, and dispatch read-only subagents. Do not mutate or start AgentTeams that would edit. Call exit_plan_mode only when planning is finished — that is a user review (Approve / Keep planning), not implementation. Stay until the result reports approved. After approved, the next step implements (AgentTeams only when the work is multi-file / parallel / durable / quality-gate; do not start AgentTeams for one-file or this-turn-only work).'
  }
  if (outcome === 'committed') {
    return 'Plan mode is on. Dispatch read-only exploration subagents. Do not mutate or start AgentTeams that would edit. Explore and ask. Call exit_plan_mode only when planning is finished — that is a user review (Approve / Keep planning), not implementation. Stay until the result reports approved. After approved, the next step implements (AgentTeams only when the work is multi-file / parallel / durable / quality-gate; do not start AgentTeams for one-file or this-turn-only work).'
  }
  return 'Plan mode will apply from the next step. Dispatch read-only exploration subagents. Do not mutate or start AgentTeams that would edit. Explore and ask. Call exit_plan_mode only when planning is finished — that is a user review (Approve / Keep planning), not implementation. Stay until the result reports approved. After approved, the next step implements (AgentTeams only when the work is multi-file / parallel / durable / quality-gate; do not start AgentTeams for one-file or this-turn-only work).'
}

export function apply(ctx) {
  ctx.tools.register({
    name: ENTER_PLAN_MODE,
    description: ENTER_DESCRIPTION,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reason: {
          type: 'string',
          description: 'Optional one-sentence reason for entering plan mode.',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['active', 'outcome'],
        properties: {
          active: { type: 'boolean', const: true },
          outcome: {
            type: 'string',
            enum: ['committed', 'queued', 'cancelled', 'noop'],
          },
        },
      },
      render(_args, value) {
        return [{ type: 'text', text: messageFor(value.outcome) }]
      },
    },
    async execute(_args, exec) {
      const agent = exec.agent
      if (agent === undefined) {
        throw new Error(`${ENTER_PLAN_MODE} requires a calling agent (no session to switch)`)
      }
      const outcome = ctx.planMode.set(agent, true)
      return { active: true, outcome }
    },
    presentCall(args) {
      const reason = typeof args?.reason === 'string' ? args.reason.trim() : ''
      return {
        card: 'generic',
        title: 'Enter plan mode',
        kind: 'other',
        content: [{ type: 'text', text: reason === '' ? 'Entering session plan mode.' : reason }],
      }
    },
    presentResult(_args, result) {
      return {
        card: 'generic',
        title: 'Plan mode',
        content: result.content,
      }
    },
  })
}
