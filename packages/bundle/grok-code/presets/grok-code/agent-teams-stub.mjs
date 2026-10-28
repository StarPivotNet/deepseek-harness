/**
 * Minimal shadow of host `agent-teams:usage` (order 117).
 *
 * The host `@nanmicoder/dsh-agent-teams` plugin registers the full ~2.5k
 * captain protocol as a global prompt section. This preset-local row
 * registers the same section name in the preset scope, so it shadows the
 * host text for this preset's sessions: the model loads the full protocol
 * from the `agent-teams` skill on demand instead of paying it every turn.
 *
 * Publishes no service. Relative path is this directory (preset-local row
 * in agent.cordis.yml).
 */

export const name = 'agent-teams-stub'
export const inject = ['systemPrompt']

export function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'agent-teams:usage',
    order: 117,
    text: 'AgentTeams (Agent Teams) provides multi-agent team collaboration. Apply these rules when the user requests a team (including /agent-teams), when continuing an existing team, or when parallel work would materially improve speed or quality. Do not start AgentTeams for one-file or this-turn-only work — edit those yourself. Mentioning, quoting, discussing, or declining AgentTeams alone is not a request to start work. Before creating, editing, resuming, or captaining a team, call `skill` with name `agent-teams` and follow the full captain protocol it loads. Every team uses approval="automatic", including user-named AgentTeams / /agent-teams. Never staged; never call agent_teams_approve. As a member, keep following your assigned task contract and report via the agent_teams_* tools with the current attempt_id. A member contract must be complete, standalone: the member does not share this conversation, so include goal / scope / constraints / inputs / output / acceptance. Be fast, accurate, strong, and smart: use live catalog tools, dispatch Agents on 2+ independent domains, never invent tools/facts/file content, never claim without this-turn evidence. On dsh-agent-teams 0.1.23 memberMaxDepth defaults to 0, so a member does not call subagent or send_message. Trust this session tool list. When launching subagent or subagent_fork, call set_subagent_reasoning_effort first with reasoning_effort off, low, or medium — not `high` or `xhigh`. Adding a member that is not a reviewer still passes reasoning_effort as off, low, or medium — not `high` or `xhigh`. Reviewers pass off or low — not medium, high, or xhigh.'
  })
}
