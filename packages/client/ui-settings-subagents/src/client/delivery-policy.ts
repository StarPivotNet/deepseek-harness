/**
 * Live busy-state delivery preference used by the Subagents Behavior group.
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm, SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  DEFAULT_SUBAGENT_BUSY_DELIVERY, JOB_BUSY_FIELD, REPORT_BUSY_FIELD, SETTLEMENT_BUSY_FIELD,
} from '../delivery-settings.ts'
import type { SubagentBusyDelivery, SubagentDeliverySettings } from '../delivery-settings.ts'

export { DEFAULT_SUBAGENT_BUSY_DELIVERY } from '../delivery-settings.ts'

/** One channel in the durable delivery section. */
export type SubagentDeliveryField =
  | typeof SETTLEMENT_BUSY_FIELD
  | typeof REPORT_BUSY_FIELD
  | typeof JOB_BUSY_FIELD

/**
 * Busy-state delivery policy used by the Subagents Behavior selectors.
 * Live values publish before the durable write starts.
 */
export class SubagentDeliveryPolicy {
  /** Reactive settlement placement. */
  readonly settlementBusy: SnapshotStore<SubagentBusyDelivery> = createSnapshotStore(DEFAULT_SUBAGENT_BUSY_DELIVERY)
  /** Reactive report placement. */
  readonly reportBusy: SnapshotStore<SubagentBusyDelivery> = createSnapshotStore(DEFAULT_SUBAGENT_BUSY_DELIVERY)
  /** Reactive Job-completion placement. */
  readonly jobBusy: SnapshotStore<SubagentBusyDelivery> = createSnapshotStore(DEFAULT_SUBAGENT_BUSY_DELIVERY)
  /** Whether the Host document currently accepts writes. */
  readonly writable: SnapshotStore<boolean> = createSnapshotStore(false)
  private readonly host: SettingsScope<SubagentDeliverySettings> | ConfigForm<SubagentDeliverySettings> | undefined

  /**
   * @param host - durable preference scope owned by the providing plugin;
   * absent compositions stay process-local.
   */
  constructor(host?: SettingsScope<SubagentDeliverySettings> | ConfigForm<SubagentDeliverySettings>) {
    this.host = host
    if (host !== undefined) {
      host.subscribe(() => { this.adopt(host) })
      this.adopt(host)
    }
  }

  /**
   * Change one busy-state field; the live value publishes before the write.
   * @param field - settlement, report, or Job channel.
   * @param behavior - Queue or Steer.
   */
  set(field: SubagentDeliveryField, behavior: SubagentBusyDelivery): void {
    const store = this.storeFor(field)
    if (store.getSnapshot() === behavior) return
    store.set(behavior)
    void this.host?.set(field, behavior)
  }

  /**
   * Adopt the scope's accepted durable section without writing it back.
   * @param host - the constructor-narrowed scope driving this adoption.
   */
  private adopt(host: SettingsScope<SubagentDeliverySettings> | ConfigForm<SubagentDeliverySettings>): void {
    const snapshot = host.getSnapshot()
    if (this.writable.getSnapshot() !== snapshot.writable) this.writable.set(snapshot.writable)
    const section = snapshot.value
    if (section === undefined) return
    if (this.settlementBusy.getSnapshot() !== section.settlementBusy) {
      this.settlementBusy.set(section.settlementBusy)
    }
    if (this.reportBusy.getSnapshot() !== section.reportBusy) this.reportBusy.set(section.reportBusy)
    if (this.jobBusy.getSnapshot() !== section.jobBusy) this.jobBusy.set(section.jobBusy)
  }

  private storeFor(field: SubagentDeliveryField): SnapshotStore<SubagentBusyDelivery> {
    if (field === SETTLEMENT_BUSY_FIELD) return this.settlementBusy
    if (field === REPORT_BUSY_FIELD) return this.reportBusy
    return this.jobBusy
  }
}
