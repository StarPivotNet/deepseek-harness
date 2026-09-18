/**
 * Host-owned Automation: durable rules that open a fresh Session on a timer.
 * @module @deepseek-ai/dsh-automation
 */
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import AutomationController from './controller.ts'
import z from '@deepseek-ai/schemastery'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-session-title'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { DomainGlobal, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { AutomationInputError, AutomationPersistenceError } from './errors.ts'
import { AutomationRuntime } from './runtime.ts'
import {
  automationDomainSpec,
  type AutomationDomainState,
  type StoredAutomationRule,
  type StoredAutomationRun,
} from './spec.ts'
import {
  MIN_EVERY_INTERVAL_SECONDS,
  advanceScheduledAt,
  createLocalClockSelector,
  formatUtcInstant,
  futureInstant,
  resolveAtInstant,
} from './time.ts'
import type {
  AutomationRuleId as AutomationRuleIdType,
  AutomationRuleRecord,
  AutomationRuleState,
  AutomationRuleView,
  AutomationRunId as AutomationRunIdType,
  AutomationRunRecord,
  CreateAutomationRuleRequest,
  UpdateAutomationRuleRequest,
} from './types.ts'

export type {
  AfterAutomationSelector,
  AtAutomationSelector,
  AtInput,
  AutomationOverlapPolicy,
  AutomationRuleRecord,
  AutomationRuleState,
  AutomationRuleView,
  AutomationRunOutcome,
  AutomationRunRecord,
  AutomationSelector,
  AutomationStartEvent,
  CreateAutomationRuleRequest,
  EveryAutomationSelector,
  LocalAtInput,
  LocalClockAutomationSelector,
  LocalClockInput,
  UpdateAutomationRuleRequest,
} from './types.ts'
export type { AutomationErrorCode } from './errors.ts'
export { AutomationInputError, AutomationPersistenceError } from './errors.ts'
export { MIN_EVERY_INTERVAL_SECONDS } from './time.ts'
export {
  advanceScheduledAt,
  canonicalizeTimeZone,
  createLocalClockSelector,
  formatUtcInstant,
  futureInstant,
  nextLocalClockInstant,
  resolveAtInstant,
} from './time.ts'
export { automationDomainSpec, automationRuleRecord, automationRunRecord, automationDomainState } from './spec.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    automation: AutomationService
  }
}

/** Plugin config: process-level fire bounds. */
export interface Config {
  /** Minimum `everySeconds` a create/update request may store. */
  minEverySeconds: number
}
/**
 * Brand a string as an {@link AutomationRuleId}.
 * @param id - Raw rule id.
 * @returns the same string, branded at compile time.
 */
export type AutomationRuleId = AutomationRuleIdType
export function AutomationRuleId(id: string): AutomationRuleId {
  return id as AutomationRuleId
}
/**
 * Brand a string as an {@link AutomationRunId}.
 * @param id - Raw run id.
 * @returns the same string, branded at compile time.
 */
export type AutomationRunId = AutomationRunIdType
export function AutomationRunId(id: string): AutomationRunId {
  return id as AutomationRunId
}
export const Config = z.object({
  minEverySeconds: z.number().default(MIN_EVERY_INTERVAL_SECONDS).min(MIN_EVERY_INTERVAL_SECONDS),
})
/** Substitutable wall clock and id mint for tests. */
export const internals = {
  now: () => Date.now(),
  uuid: () => randomUUID(),
}
const MAX_NAME_CHARS = 80
/**
 * Host-owned Automation service. CRUD, listing, and fire all go through this
 * object; tools and Host RPC must not write the domain tables themselves.
 */
export class AutomationService extends Service {
  static inject = ['storageDomain', 'agents', 'sessions', 'workspaceRegistry', 'agentDefaultModel']
  static Config = Config
  private rules?: KvTable<AutomationRuleId, StoredAutomationRule>
  private runs?: KvTable<AutomationRunId, StoredAutomationRun>
  private global?: DomainGlobal<AutomationDomainState>
  private state?: AutomationDomainState
  private operationTail: Promise<void> = Promise.resolve()
  private runtime?: AutomationRuntime
  constructor(ctx: Context, public readonly config: Config) {
    super(ctx, 'automation')
    ctx.plugin(AutomationController)
  }
  /** Open the domain and start the process-local timer owner. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(automationDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'automation.domainClose')
    this.rules = domain.table('rules')
    this.runs = domain.table('runs')
    this.global = domain.global
    this.state = domain.global.get()
    const runtime = new AutomationRuntime(this.ctx, this, () => internals.now())
    this.runtime = runtime
    this.ctx.effect(() => {
      runtime.start()
      return () => runtime.dispose()
    }, 'automation.runtime')
    this.ctx.effect(() => this.ctx.on('agent/created', ({ agent }) => {
      this.runtime?.watchEnded(agent, (endedAt) => {
        void this.markRunEnded(agent.session.id, endedAt)
      })
    }), 'automation.watchCreatedAgents')
    this.reconcileOpenRuns()
  }
  /**
     * List every rule in creation order with derived delivery state.
     * @returns detached rule views.
     */
  list(): AutomationRuleView[] {
    return this.ruleRecords().map(record => this.viewOf(record, internals.now()))
  }
  /**
     * Read one rule.
     * @param id - Rule id.
     * @returns the view, or `undefined` when unknown.
     */
  get(id: AutomationRuleId): AutomationRuleView | undefined {
    const record = this.requireRules().get(id)
    return record === undefined ? undefined : this.viewOf(record, internals.now())
  }
  /**
     * Create one enabled rule and arm its first target.
     * @param request - Caller-supplied fields; exactly one time selector.
     * @returns the created view.
     */
  create(request: CreateAutomationRuleRequest): Promise<AutomationRuleView> {
    return this.enqueue(async () => {
      const now = internals.now()
      const record = this.buildCreateRecord(request, now)
      await this.requireWorkspace(record.workspaceId)
      await this.requireAgentPreset(record.agentPreset)
      this.requirePermissionPreset(record.permissionPreset)
      const state = this.requireState()
      if (state.usedRuleIds.includes(record.id)) {
        throw new AutomationInputError('internal_error', `automation rule id '${record.id}' was reused`)
      }
      await this.requireRules().put(record.id, record)
      await this.setState({ ...state, usedRuleIds: [...state.usedRuleIds, record.id] })
      this.runtime?.requestDrive()
      return this.viewOf(record, now)
    })
  }
  /**
     * Apply a sparse patch. Selector fields replace the whole selector.
     * @param id - Existing rule.
     * @param patch - Fields to change.
     * @returns the updated view.
     */
  update(id: AutomationRuleId, patch: UpdateAutomationRuleRequest): Promise<AutomationRuleView> {
    return this.enqueue(async () => {
      const current = this.requireRule(id)
      const now = internals.now()
      const next = this.buildUpdateRecord(current, patch, now)
      await this.requireWorkspace(next.workspaceId)
      await this.requireAgentPreset(next.agentPreset)
      this.requirePermissionPreset(next.permissionPreset)
      await this.requireRules().put(id, next)
      this.runtime?.requestDrive()
      return this.viewOf(next, now)
    })
  }
  /**
     * Delete one rule. Its id is never reused. Runs stay for history.
     * @param id - Rule to remove.
     * @returns `true` when a record was deleted.
     */
  delete(id: AutomationRuleId): Promise<boolean> {
    return this.enqueue(async () => {
      const deleted = await this.requireRules().delete(id)
      if (deleted)
        this.runtime?.requestDrive()
      return deleted
    })
  }
  /**
     * Enable or disable one rule without rewriting its selector.
     * @param id - Existing rule.
     * @param enabled - Next armed state.
     * @returns the updated view.
     */
  setEnabled(id: AutomationRuleId, enabled: boolean): Promise<AutomationRuleView> {
    return this.update(id, { enabled })
  }
  /**
     * Fire one rule immediately without moving its next scheduled target.
     * @param id - Existing rule.
     * @returns the run written for this attempt.
     */
  runNow(id: AutomationRuleId): Promise<AutomationRunRecord> {
    return this.enqueue(() => this.fire(id, internals.now(), { advance: false, source: 'manual' }))
  }
  /**
     * Recent runs for one rule, newest first.
     * @param id - Existing rule.
     * @param limit - Maximum rows; defaults to 20.
     * @returns detached run records.
     */
  listRuns(id: AutomationRuleId, limit: number = 20): AutomationRunRecord[] {
    const cap = Number.isSafeInteger(limit) && limit > 0 ? limit : 20
    return [...this.requireRuns().entries()]
      .map(([, record]) => publishedRun(record))
      .filter(record => record.ruleId === id)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt) || right.id.localeCompare(left.id))
      .slice(0, cap)
  }
  /**
     * Enabled rules whose target is due at `now`.
     * @param now - Wall-clock decision time.
     * @returns due records in target then create order.
     */
  dueRules(now: number): readonly AutomationRuleRecord[] {
    return this.ruleRecords()
      .filter(record => record.enabled && Date.parse(record.scheduledAt) <= now)
      .sort((left, right) => Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt)
            || left.createdAt.localeCompare(right.createdAt)
            || left.id.localeCompare(right.id))
  }
  /**
     * Earliest future target among enabled rules.
     * @param now - Wall-clock decision time.
     * @returns epoch milliseconds, or `undefined` when nothing is armed.
     */
  nextWakeAt(now: number): number | undefined {
    return this.ruleRecords().reduce<number | undefined>((selected, record) => {
      if (!record.enabled)
        return selected
      const candidate = Date.parse(record.scheduledAt)
      return candidate > now && (selected === undefined || candidate < selected) ? candidate : selected
    }, undefined)
  }
  /**
     * Admit one due rule from the timer owner.
     * @param id - Due rule.
     * @param now - Shared decision time for this batch.
     * @returns the run written for this attempt.
     */
  fireDue(id: AutomationRuleId, now: number): Promise<AutomationRunRecord> {
    return this.enqueue(() => this.fire(id, now, { advance: true, source: 'schedule' }))
  }

  /**
   * Delete one past run. Its id is never reused.
   * @param id - Run to remove.
   * @returns `true` when a record was deleted.
   */
  deleteRun(id: AutomationRunId): Promise<boolean> {
    return this.enqueue(async () => {
      return await this.requireRuns().delete(id)
    })
  }

  /** Close any started run whose Session is already idle or gone. */
  private reconcileOpenRuns(): void {
    const now = formatUtcInstant(internals.now())
    for (const [, record] of this.requireRuns().entries()) {
      if (record.outcome !== 'started' || record.endedAt !== undefined || record.sessionId === undefined) continue
      const agent = this.ctx.agents.get(record.sessionId)
      if (agent === undefined || agent.status === 'idle') {
        void this.markRunEnded(record.sessionId, now)
      }
    }
  }

  /**
   * Record that a started Session left `running`.
   * @param sessionId - Session this run opened.
   * @param endedAt - Wall-clock instant the agent became idle or disposed.
   */
  markRunEnded(sessionId: SessionId, endedAt: string): Promise<void> {
    return this.enqueue(async () => {
      const match = [...this.requireRuns().entries()]
        .map(([, record]) => record)
        .find(record => record.sessionId === sessionId && record.outcome === 'started' && record.endedAt === undefined)
      if (match === undefined) return
      await this.requireRuns().put(match.id, { ...match, endedAt })
    })
  }

  private async fire(id: AutomationRuleId, now: number, options: { advance: boolean; source: 'schedule' | 'manual' }): Promise<AutomationRunRecord> {
    const rule = this.requireRule(id)
    if (!rule.enabled) {
      throw new AutomationInputError('rule_not_found', `automation rule '${id}' is disabled`)
    }
    const previous = this.latestStartedRun(id)
    const busy = previous === undefined ? undefined : this.busyAgent(previous.sessionId)
    if (busy !== undefined) {
      if (rule.onOverlap === 'skip') {
        const skipped = await this.writeRun({
          ruleId: id,
          startedAt: formatUtcInstant(now),
          endedAt: formatUtcInstant(now),
          outcome: 'skipped_busy',
          source: options.source,
        })
        if (options.advance && (rule.selector.kind === 'every' || rule.selector.kind === 'local-clock')) {
          await this.advanceAfterFire(rule, now)
        }
        this.runtime?.watchIdle(id, busy)
        return publishedRun(skipped)
      }
      busy.cancel({ kind: 'automation', ruleId: id }, { keepInbox: false })
      if (previous !== undefined) {
        await this.requireRuns().put(previous.id, {
          ...previous,
          outcome: 'replaced',
          endedAt: previous.endedAt ?? formatUtcInstant(now),
        })
      }
    }
    try {
      const agent = await this.openSession(rule)
      const run = await this.writeRun({
        ruleId: id,
        sessionId: agent.session.id,
        startedAt: formatUtcInstant(now),
        outcome: 'started',
        source: options.source,
      })
      this.runtime?.watchEnded(agent, (endedAt) => {
        void this.markRunEnded(agent.session.id, endedAt)
      })
      agent.session.append('automation/start', {
        ruleId: id,
        runId: run.id,
        scheduledAt: rule.scheduledAt,
      })
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: rule.task }],
        source: { kind: 'plugin', plugin: 'automation' },
      }))
      this.applyFiredSessionTitle(agent.session, rule.name)
      const workspace = this.ctx.workspaceRegistry.get(rule.workspaceId)
      if (workspace !== undefined)
        await workspace.attachSession(agent.session.id)
      if (options.advance)
        await this.advanceAfterFire(rule, now)
      this.runtime?.requestDrive()
      return publishedRun(run)
    }
    catch (error) {
      await this.writeRun({
        ruleId: id,
        startedAt: formatUtcInstant(now),
        endedAt: formatUtcInstant(now),
        outcome: 'failed',
        source: options.source,
        errorCode: error instanceof AutomationInputError ? error.code : 'internal_error',
      })
      if (options.advance) {
        try {
          await this.advanceAfterFire(rule, now)
        }
        catch {
          // A failed fire already recorded its outcome; a later drive retries the next target.
        }
      }
      if (error instanceof AutomationInputError)
        throw error
      throw new AutomationInputError('internal_error', `automation fire for '${id}' failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
  }
  private async openSession(rule: StoredAutomationRule) {
    const workspace = await this.requireWorkspace(rule.workspaceId)
    const cwd = workspace.path
    const sessionId = SessionId(`session-${internals.uuid()}`)
    const presets = this.ctx.get('agentPresets')
    const defaultModel = this.ctx.get('agentDefaultModel')
    if (defaultModel === undefined) {
      throw new AutomationInputError('internal_error', 'automation requires ctx.agentDefaultModel')
    }
    const selection = defaultModel.currentSelection()
    const selected = { current: selection, assembled: undefined }
    let agentPreset = rule.agentPreset
    if (presets !== undefined) {
      const resolved = await presets.resolve(agentPreset)
      if (resolved.broken !== undefined) {
        throw new AutomationInputError('agent_preset_not_found', `agent preset '${resolved.id}' cannot compose a session`)
      }
      agentPreset = resolved.id
    }
    const { agent } = await this.ctx.agents.create({
      sessionId,
      agentOptions: { provider: selection.provider, model: selection.model },
      meta: {
        cwd,
        origin: 'automation',
        ...agentPreset === undefined ? {} : { agentPreset },
      },
      setup: async (agentCtx) => {
        installModelSelection(agentCtx, selected)
        if (presets !== undefined && agentPreset !== undefined)
          await presets.mount(agentCtx, agentPreset)
      },
    })
    const permissions = this.ctx.get('permissionPresets')
    if (rule.permissionPreset !== undefined) {
      if (permissions === undefined) {
        throw new AutomationInputError('permission_preset_not_found', 'automation permissionPreset requires ctx.permissionPresets')
      }
      permissions.set(agent.session, rule.permissionPreset)
    }
    return agent
  }
  private async advanceAfterFire(rule: StoredAutomationRule, now: number) {
    const nextAt = advanceScheduledAt(rule.selector, rule.scheduledAt, now)
    if (nextAt === undefined) {
      await this.requireRules().put(rule.id, {
        ...rule,
        enabled: false,
        updatedAt: formatUtcInstant(now),
      })
      return
    }
    await this.requireRules().put(rule.id, {
      ...rule,
      scheduledAt: nextAt,
      updatedAt: formatUtcInstant(now),
    })
  }
  /**
   * Name a fired Session after the rule so the list does not fall back to the workspace basename.
   * Prefers the live store Session, then `sessionTitle.rename`, then a direct `session/title` append.
   * Title-service absence or a failed rename leaves the fire itself intact.
   * @param session - published Session this fire opened.
   * @param name - durable rule name.
   */
  private applyFiredSessionTitle(session: Session, name: string): void {
    const live = this.ctx.sessions.get(session.id) ?? session
    const titles = this.ctx.get('sessionTitle')
    if (titles !== undefined) {
      try {
        titles.rename(live, name)
        return
      } catch (error) {
        this.ctx.logger.warn(`automation: naming session '${session.id}' failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const title = name.trim()
    if (title.length === 0) return
    try {
      live.append('session/title', {
        title,
        messageSeqs: [],
        source: { kind: 'user' },
      })
    } catch (error) {
      this.ctx.logger.warn(`automation: appending title for session '${session.id}' failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private latestStartedRun(ruleId: AutomationRuleId) {
    return [...this.requireRuns().entries()]
      .map(([, record]) => record)
      .filter(record => record.ruleId === ruleId && record.outcome === 'started' && record.sessionId !== undefined)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt) || right.id.localeCompare(left.id))[0]
  }
  private busyAgent(sessionId: SessionId | undefined) {
    if (sessionId === undefined)
      return undefined
    const agent = this.ctx.agents.get(sessionId)
    return agent?.status === 'running' ? agent : undefined
  }
  private async writeRun(record: Omit<StoredAutomationRun, 'id'> & { id?: AutomationRunId }) {
    const id = record.id ?? AutomationRunId(`run-${internals.uuid()}`)
    const state = this.requireState()
    if (state.usedRunIds.includes(id)) {
      throw new AutomationInputError('internal_error', `automation run id '${id}' was reused`)
    }
    const stored = {
      id,
      ruleId: record.ruleId,
      startedAt: record.startedAt,
      outcome: record.outcome,
      ...record.sessionId === undefined ? {} : { sessionId: record.sessionId },
      ...record.endedAt === undefined ? {} : { endedAt: record.endedAt },
      ...record.source === undefined ? {} : { source: record.source },
      ...record.errorCode === undefined ? {} : { errorCode: record.errorCode },
    }
    await this.requireRuns().put(id, stored)
    await this.setState({ ...state, usedRunIds: [...state.usedRunIds, id] })
    return stored
  }
  private buildCreateRecord(request: CreateAutomationRuleRequest, now: number) {
    const task = trimRequired(request.task, 'invalid_task', 'task must be a non-empty string')
    const name = request.name === undefined
      ? titleFromTask(task)
      : trimRequired(request.name, 'invalid_name', 'name must be a non-empty string')
    const selector = this.resolveSelector(request, now)
    return {
      id: AutomationRuleId(`rule-${internals.uuid()}`),
      name,
      enabled: true,
      task,
      workspaceId: request.workspaceId,
      ...request.agentPreset === undefined ? {} : { agentPreset: request.agentPreset },
      ...request.permissionPreset === undefined ? {} : { permissionPreset: request.permissionPreset },
      onOverlap: request.onOverlap ?? 'skip',
      selector: durableSelector(selector.selector),
      scheduledAt: selector.scheduledAt,
      createdAt: formatUtcInstant(now),
      updatedAt: formatUtcInstant(now),
    }
  }
  private buildUpdateRecord(current: StoredAutomationRule, patch: UpdateAutomationRuleRequest, now: number) {
    const selectorPatch = this.selectorPatch(patch)
    const selector = selectorPatch === undefined
      ? { selector: current.selector, scheduledAt: current.scheduledAt }
      : this.resolveSelector(selectorPatch, now)
    const task = patch.task === undefined
      ? current.task
      : trimRequired(patch.task, 'invalid_task', 'task must be a non-empty string')
    const name = patch.name === undefined
      ? current.name
      : trimRequired(patch.name, 'invalid_name', 'name must be a non-empty string')
    return {
      ...current,
      name,
      task,
      enabled: patch.enabled ?? current.enabled,
      workspaceId: patch.workspaceId ?? current.workspaceId,
      ...nextOptional(current.agentPreset, patch.agentPreset, 'agentPreset'),
      ...nextOptional(current.permissionPreset, patch.permissionPreset, 'permissionPreset'),
      onOverlap: patch.onOverlap ?? current.onOverlap,
      selector: durableSelector(selector.selector),
      scheduledAt: selector.scheduledAt,
      updatedAt: formatUtcInstant(now),
    }
  }
  private selectorPatch(patch: UpdateAutomationRuleRequest) {
    const present = [patch.afterSeconds, patch.at, patch.everySeconds, patch.localClock]
      .filter(value => value !== undefined).length
    if (present === 0)
      return undefined
    if (present !== 1) {
      throw new AutomationInputError('invalid_selector', 'update must supply exactly one of afterSeconds, at, everySeconds, or localClock')
    }
    return {
      task: 'unused',
      workspaceId: WorkspaceId('unused'),
      ...patch.afterSeconds === undefined ? {} : { afterSeconds: patch.afterSeconds },
      ...patch.at === undefined ? {} : { at: patch.at },
      ...patch.everySeconds === undefined ? {} : { everySeconds: patch.everySeconds },
      ...patch.localClock === undefined ? {} : { localClock: patch.localClock },
    }
  }
  private resolveSelector(request: CreateAutomationRuleRequest, now: number) {
    const present = [request.afterSeconds, request.at, request.everySeconds, request.localClock]
      .filter(value => value !== undefined).length
    if (present !== 1) {
      throw new AutomationInputError('invalid_selector', 'exactly one of afterSeconds, at, everySeconds, or localClock is required')
    }
    if (request.afterSeconds !== undefined) {
      if (!Number.isSafeInteger(request.afterSeconds) || request.afterSeconds <= 0) {
        throw new AutomationInputError('invalid_selector', 'afterSeconds must be a positive safe integer')
      }
      return {
        selector: { kind: 'after', afterSeconds: request.afterSeconds },
        scheduledAt: futureInstant(now + request.afterSeconds * 1_000, now),
      }
    }
    if (request.at !== undefined) {
      return { selector: { kind: 'at' }, scheduledAt: resolveAtInstant(request.at, now) }
    }
    if (request.everySeconds !== undefined) {
      if (!Number.isSafeInteger(request.everySeconds) || request.everySeconds < this.config.minEverySeconds) {
        throw new AutomationInputError('frequency_too_high', `everySeconds must be a safe integer of at least ${this.config.minEverySeconds}`)
      }
      return {
        selector: { kind: 'every', everySeconds: request.everySeconds },
        scheduledAt: futureInstant(now + request.everySeconds * 1_000, now),
      }
    }
    /* v8 ignore next -- present === 1 and the other three are absent. */
    if (request.localClock === undefined) {
      throw new AutomationInputError('invalid_selector', 'exactly one time selector is required')
    }
    return createLocalClockSelector(request.localClock, now)
  }
  private viewOf(record: StoredAutomationRule, now: number): AutomationRuleView {
    const due = Date.parse(record.scheduledAt) <= now
    const state: AutomationRuleState = record.enabled ? (due ? 'overdue' : 'scheduled') : 'disabled'
    return {
      ...publishedRule(record),
      state,
      nextAt: record.scheduledAt,
    }
  }
  private ruleRecords() {
    return [...this.requireRules().entries()]
      .map(([, record]) => record)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
  }
  private requireRule(id: AutomationRuleId) {
    const record = this.requireRules().get(id)
    if (record === undefined) {
      throw new AutomationInputError('rule_not_found', `automation rule '${id}' was not found`)
    }
    return record
  }
  private async requireWorkspace(id: WorkspaceId) {
    const registry = this.ctx.get('workspaceRegistry')
    if (registry === undefined) {
      throw new AutomationInputError('workspace_not_found', 'automation requires ctx.workspaceRegistry')
    }
    const workspace = registry.get(id)
    if (workspace === undefined) {
      throw new AutomationInputError('workspace_not_found', `workspace '${id}' was not found`)
    }
    return workspace
  }
  private async requireAgentPreset(id: string | undefined) {
    if (id === undefined)
      return
    const presets = this.ctx.get('agentPresets')
    if (presets === undefined) {
      throw new AutomationInputError('agent_preset_not_found', 'automation agentPreset requires ctx.agentPresets')
    }
    try {
      const preset = await presets.resolve(id)
      if (preset.broken !== undefined) {
        throw new AutomationInputError('agent_preset_not_found', `agent preset '${id}' cannot compose a session`)
      }
    }
    catch (error) {
      if (error instanceof AutomationInputError)
        throw error
      throw new AutomationInputError('agent_preset_not_found', `agent preset '${id}' was not found`, { cause: error })
    }
  }
  private requirePermissionPreset(id: string | undefined) {
    if (id === undefined)
      return
    const permissions = this.ctx.get('permissionPresets')
    if (permissions === undefined) {
      throw new AutomationInputError('permission_preset_not_found', 'automation permissionPreset requires ctx.permissionPresets')
    }
    if (!permissions.names.includes(id)) {
      throw new AutomationInputError('permission_preset_not_found', `permission preset '${id}' was not found`)
    }
  }
  private requireRules() {
    if (this.rules === undefined)
      throw new Error('automation service is not started yet')
    return this.rules
  }
  private requireRuns() {
    if (this.runs === undefined)
      throw new Error('automation service is not started yet')
    return this.runs
  }
  private requireState() {
    if (this.state === undefined)
      throw new Error('automation service is not started yet')
    return this.state
  }
  private async setState(state: AutomationDomainState) {
    const global = this.global
    if (global === undefined)
      throw new Error('automation service is not started yet')
    await global.set(state)
    this.state = state
  }
  private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation, operation)
    this.operationTail = result.then(() => undefined, (error) => {
      if (!(error instanceof AutomationInputError) && !(error instanceof AutomationPersistenceError)) {
        this.ctx.logger.warn(`automation: queued operation failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
    return result
  }
}
/** Trim and reject empty caller text. */
function trimRequired(value, code, message) {
  if (typeof value !== 'string')
    throw new AutomationInputError(code, message)
  const trimmed = value.trim()
  if (trimmed.length === 0)
    throw new AutomationInputError(code, message)
  return trimmed
}
/** Drop undefined optional keys so exactOptionalPropertyTypes stays honest. */
function publishedRun(record) {
  return {
    id: record.id,
    ruleId: record.ruleId,
    startedAt: record.startedAt,
    outcome: record.outcome,
    ...record.sessionId === undefined ? {} : { sessionId: record.sessionId },
    ...record.endedAt === undefined ? {} : { endedAt: record.endedAt },
    ...record.source === undefined ? {} : { source: record.source },
    ...record.errorCode === undefined ? {} : { errorCode: record.errorCode },
  }
}
/** Publish one durable rule without undefined optional keys. */
function publishedRule(record) {
  return {
    id: record.id,
    name: record.name,
    enabled: record.enabled,
    task: record.task,
    workspaceId: record.workspaceId,
    onOverlap: record.onOverlap,
    selector: durableSelector(record.selector),
    scheduledAt: record.scheduledAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...record.agentPreset === undefined ? {} : { agentPreset: record.agentPreset },
    ...record.permissionPreset === undefined ? {} : { permissionPreset: record.permissionPreset },
  }
}
/** Normalize a selector so optional weekday lists are absent, not undefined. */
function durableSelector(selector) {
  if (selector.kind !== 'local-clock')
    return selector
  return {
    kind: 'local-clock',
    time: selector.time,
    timeZone: selector.timeZone,
    ...selector.weekdays === undefined ? {} : { weekdays: selector.weekdays },
  }
}
/** Derive a short display name from the task text. */
function titleFromTask(task) {
  const line = task.split(/\r?\n/, 1)[0] ?? task
  return line.length <= MAX_NAME_CHARS ? line : `${line.slice(0, MAX_NAME_CHARS - 1)}…`
}
/** Apply an optional-field patch that uses `null` to clear. */
function nextOptional(current, patch, key) {
  if (patch === undefined)
    return current === undefined ? {} : { [key]: current }
  if (patch === null)
    return {}
  const trimmed = patch.trim()
  if (trimmed.length === 0) {
    throw new AutomationInputError(key === 'agentPreset' ? 'agent_preset_not_found' : 'permission_preset_not_found', `${key} must be a non-empty string when provided`)
  }
  return { [key]: trimmed }
}
export default AutomationService
