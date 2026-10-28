# Host 拥有的 Automation

[English](automation.md) | 中文

Automation 拥有持久规则，到期时返回的是 **新 Session**，不是已有对话的后续 turn。Session 事件日志不是规则表：规则住在 `automation` storage domain。[包 README](../../packages/automation/automation/README.zh.md) 负责组合、开火行为和互斥策略。

## 持久记录

`AutomationRuleId` 和 `AutomationRunId` 是 branded id，唯一且永不复用。第 1 版存储 enabled 开关、task 文本、workspace id、可选 preset 名、`onOverlap`、一个选择器，以及规范 UTC `scheduledAt`。

```ts type-equiv
/** Stable Automation rule identity. Never reused after delete. */
type AutomationRuleId = Branded<'AutomationRuleId'>
```

```ts type-equiv
/** What to do when this rule's previous started session is still running. */
type AutomationOverlapPolicy = 'skip' | 'replace'
```

```ts type-equiv
/** Closed durable selector union stored on a rule. */
type AutomationSelector =
  | AfterAutomationSelector
  | AtAutomationSelector
  | EveryAutomationSelector
  | LocalClockAutomationSelector
```

```ts type-equiv
/** Create request: exactly one time selector field must be present. */
interface CreateAutomationRuleRequest {
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
```

```ts type-equiv
/** Sparse update. Changing the selector still requires exactly one selector field. */
interface UpdateAutomationRuleRequest {
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
```

```ts type-equiv
/** Durable rule record. */
interface AutomationRuleRecord {
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
```

```ts type-equiv
/** Model- and UI-facing view of one rule. */
interface AutomationRuleView extends AutomationRuleRecord {
  readonly state: AutomationRuleState
  readonly nextAt: string
}
```

```ts type-equiv
/** Durable fire attempt. */
interface AutomationRunRecord {
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
```

开火写入一条 run（`started`、`skipped_busy`、`replaced` 或 `failed`）；成功开始的 Session 再追加仅日志的 `automation/start`。模型可见输入仍是普通 `user/message`。

## 实时投递

进程内 owner 从 enabled 规则推导最早定时器，每次有界等待后重读墙钟。冷 Host 不做任何事。到期规则占用一条 Host 范围队列，且每条独立规则即使已有其他 Automation Session 在跑也可以开火。`skip` 等待该规则上一个 Agent 离开 `running`；`replace` 取消该 Agent 并立即打开下一条 Session。

开火创建的 Session header 带 `origin: 'automation'`。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxautomation--automationservice"></a>

### `ctx.automation` — `AutomationService`

Host-owned Automation service. CRUD, listing, and fire all go through this object; tools and Host RPC must not write the domain tables themselves.

```ts cordis-catalog
/**
   * List every rule in creation order with derived delivery state.
   * @returns detached rule views.
   */
list(): AutomationRuleView[]

/**
   * Read one rule.
   * @param id - Rule id.
   * @returns the view, or `undefined` when unknown.
   */
get(id: AutomationRuleId): AutomationRuleView | undefined

/**
   * Create one enabled rule and arm its first target.
   * @param request - Caller-supplied fields; exactly one time selector.
   * @returns the created view.
   */
create(request: CreateAutomationRuleRequest): Promise<AutomationRuleView>

/**
   * Apply a sparse patch. Selector fields replace the whole selector.
   * @param id - Existing rule.
   * @param patch - Fields to change.
   * @returns the updated view.
   */
update(id: AutomationRuleId, patch: UpdateAutomationRuleRequest): Promise<AutomationRuleView>

/**
   * Delete one rule. Its id is never reused. Runs stay for history.
   * @param id - Rule to remove.
   * @returns `true` when a record was deleted.
   */
delete(id: AutomationRuleId): Promise<boolean>

/**
   * Enable or disable one rule without rewriting its selector.
   * @param id - Existing rule.
   * @param enabled - Next armed state.
   * @returns the updated view.
   */
setEnabled(id: AutomationRuleId, enabled: boolean): Promise<AutomationRuleView>

/**
   * Fire one rule immediately without moving its next scheduled target.
   * @param id - Existing rule.
   * @returns the run written for this attempt.
   */
runNow(id: AutomationRuleId): Promise<AutomationRunRecord>

/**
   * Recent runs for one rule, newest first.
   * @param id - Existing rule.
   * @param limit - Maximum rows; defaults to 20.
   * @returns detached run records.
   */
listRuns(id: AutomationRuleId, limit: number = 20): AutomationRunRecord[]

/**
   * Delete one past run. Its id is never reused.
   * @param id - Run to remove.
   * @returns `true` when a record was deleted.
   */
deleteRun(id: AutomationRunId): Promise<boolean>

/**
   * Enabled rules whose target is due at `now`.
   * @param now - Wall-clock decision time.
   * @returns due records in target then create order.
   */
dueRules(now: number): readonly AutomationRuleRecord[]

/**
   * Earliest future target among enabled rules.
   * @param now - Wall-clock decision time.
   * @returns epoch milliseconds, or `undefined` when nothing is armed.
   */
nextWakeAt(now: number): number | undefined

/**
   * Admit one due rule from the timer owner.
   * @param id - Due rule.
   * @param now - Shared decision time for this batch.
   * @returns the run written for this attempt.
   */
fireDue(id: AutomationRuleId, now: number): Promise<AutomationRunRecord>
```

Source: [`packages/automation/automation/src/index.ts:120`](../../packages/automation/automation/src/index.ts)
<!-- END GENERATED cordis-surface -->
