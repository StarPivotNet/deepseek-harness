/**
 * Public Automation vocabulary: rule and run records, selectors, and views.
 * Types only — factories live beside the service.
 * @module @deepseek-ai/dsh-automation/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

/** Stable Automation rule identity. Never reused after delete. */
export type AutomationRuleId = Branded<'AutomationRuleId'>

/** Stable Automation run identity. Never reused. */
export type AutomationRunId = Branded<'AutomationRunId'>

/** What to do when this rule's previous started session is still running. */
export type AutomationOverlapPolicy = 'skip' | 'replace'

/** Durable one-shot delay selector retained after create. */
export interface AfterAutomationSelector {
  readonly kind: 'after'
  readonly afterSeconds: number
}

/** Durable absolute one-shot selector. The instant lives on `scheduledAt`. */
export interface AtAutomationSelector {
  readonly kind: 'at'
}

/** Durable fixed-rate selector aligned to its create-plus-interval sequence. */
export interface EveryAutomationSelector {
  readonly kind: 'every'
  readonly everySeconds: number
}

/** Durable local wall-clock selector. `weekdays` omitted means every day. */
export interface LocalClockAutomationSelector {
  readonly kind: 'local-clock'
  readonly time: string
  readonly weekdays?: readonly number[]
  readonly timeZone: string
}

/** Closed durable selector union stored on a rule. */
export type AutomationSelector =
  | AfterAutomationSelector
  | AtAutomationSelector
  | EveryAutomationSelector
  | LocalClockAutomationSelector

/** Structured local-calendar input accepted by create/update `at`. */
export interface LocalAtInput {
  readonly date: string
  readonly time: string
  readonly time_zone: string
}

/** Absolute selector accepted at the service boundary. */
export type AtInput = string | LocalAtInput

/** Local-clock input accepted at the service boundary. */
export interface LocalClockInput {
  readonly time: string
  readonly weekdays?: readonly number[]
  readonly time_zone: string
}

/** Create request: exactly one time selector field must be present. */
export interface CreateAutomationRuleRequest {
  readonly name?: string
  readonly task: string
  readonly workspaceId: WorkspaceId
  readonly agentPreset?: string
  readonly permissionPreset?: string
  readonly onOverlap?: AutomationOverlapPolicy
  readonly afterSeconds?: number
  readonly at?: AtInput
  readonly everySeconds?: number
  readonly localClock?: LocalClockInput
}

/** Sparse update. Changing the selector still requires exactly one selector field. */
export interface UpdateAutomationRuleRequest {
  readonly name?: string
  readonly task?: string
  readonly workspaceId?: WorkspaceId
  readonly agentPreset?: string | null
  readonly permissionPreset?: string | null
  readonly onOverlap?: AutomationOverlapPolicy
  readonly enabled?: boolean
  readonly afterSeconds?: number
  readonly at?: AtInput
  readonly everySeconds?: number
  readonly localClock?: LocalClockInput
}

/** Durable rule record. */
export interface AutomationRuleRecord {
  readonly id: AutomationRuleId
  readonly name: string
  readonly enabled: boolean
  readonly task: string
  readonly workspaceId: WorkspaceId
  readonly agentPreset?: string
  readonly permissionPreset?: string
  readonly onOverlap: AutomationOverlapPolicy
  readonly selector: AutomationSelector
  readonly scheduledAt: string
  readonly createdAt: string
  readonly updatedAt: string
}

/** Delivery timing derived from the durable record and wall clock. */
export type AutomationRuleState = 'scheduled' | 'overdue' | 'disabled'

/** Model- and UI-facing view of one rule. */
export interface AutomationRuleView extends AutomationRuleRecord {
  readonly state: AutomationRuleState
  readonly nextAt: string
}

/** Closed run outcome. */
export type AutomationRunOutcome = 'started' | 'skipped_busy' | 'replaced' | 'failed'

/** How this fire was admitted. Absent on records written before the field existed. */
export type AutomationRunSource = 'schedule' | 'manual'

/** Durable fire attempt. */
export interface AutomationRunRecord {
  readonly id: AutomationRunId
  readonly ruleId: AutomationRuleId
  readonly sessionId?: SessionId
  readonly startedAt: string
  /** Instant the started Session left `running`, or the skip/fail instant. */
  readonly endedAt?: string
  readonly outcome: AutomationRunOutcome
  readonly source?: AutomationRunSource
  readonly errorCode?: string
}

/** Payload of the log-only `automation/start` event on a fired session. */
export interface AutomationStartEvent {
  readonly ruleId: AutomationRuleId
  readonly runId: AutomationRunId
  readonly scheduledAt: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Records that Host Automation queued the opening prompt on this session.
     * Log-only: the model-visible input is the ordinary `user/message`.
     */
    'automation/start': AutomationStartEvent
  }
}

/** Listing of Host-owned Automation rules. */
export interface AutomationListValue {
  readonly items: readonly AutomationRuleView[]
}

/** One Host-owned Automation rule. */
export interface AutomationRuleValue {
  readonly rule: AutomationRuleView
}

/** One Host-owned Automation fire attempt. */
export interface AutomationRunValue {
  readonly run: AutomationRunRecord
}

/** Confirmation that one Automation rule was deleted. */
export interface AutomationDeleteValue {
  readonly id: string
  readonly deleted: boolean
}


declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'automation/rejected': { readonly automationCode: string }
  }
}
