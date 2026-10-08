/**
 * Live session-history tools gate preference used by the Settings row:
 * one boolean scope bridged onto row-facing snapshot stores.
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm, SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'

/** Settings namespace owned by the host-side session-history gate plugin. */
export const SESSION_HISTORY_TOOLS_NS = 'session-history-tools'

/** Settings section stored under {@link SESSION_HISTORY_TOOLS_NS}. */
export interface SessionHistoryToolsSettings {
  /** Whether model-facing session-history search/read tools are exposed. */
  enabled: boolean
}

/** Live gate preference published to the Settings row. */
export class SessionHistoryGatePreference {
  /** Reactive enabled state; optimistic between a toggle and its settlement. */
  readonly enabled: SnapshotStore<boolean> = createSnapshotStore(false)
  /** Whether the settings document currently accepts this namespace's writes. */
  readonly writable: SnapshotStore<boolean> = createSnapshotStore(false)
  /** Whether a toggle write is still settling. */
  readonly saving: SnapshotStore<boolean> = createSnapshotStore(false)
  private generation = 0
  private readonly unsubscribe: () => void

  /**
   * @param scope - bound `session-history-tools` settings scope; a namespace
   * the Host does not expose stays closed and read-only.
   */
  constructor(private readonly scope: SettingsScope<SessionHistoryToolsSettings> | ConfigForm<SessionHistoryToolsSettings>) {
    this.unsubscribe = scope.subscribe(() => { this.adopt() })
    this.adopt()
  }

  /**
   * Change the gate. The live value publishes before the write and reverts to
   * the scope's accepted section when the write does not land.
   * @param enabled - next enabled state.
   */
  setEnabled(enabled: boolean): void {
    const snapshot = this.scope.getSnapshot()
    if (snapshot.status !== 'ready' || !snapshot.writable) return
    if (this.enabled.getSnapshot() === enabled) return
    this.enabled.set(enabled)
    const generation = ++this.generation
    this.saving.set(true)
    // A rejected write needs no error object here: the scope's accepted
    // section is the recovery path, re-adopted below.
    void this.scope.set('enabled', enabled)
      .catch(() => {})
      .finally(() => {
        if (generation !== this.generation) return
        this.adopt()
        this.saving.set(false)
      })
  }

  /** Stop observing the scope and suppress late write settlements. */
  dispose(): void {
    this.generation += 1
    this.saving.set(false)
    this.unsubscribe()
  }

  /** Adopt the scope's accepted section without writing it back. */
  private adopt(): void {
    const snapshot = this.scope.getSnapshot()
    const enabled = snapshot.value?.enabled ?? false
    const writable = snapshot.status === 'ready' && snapshot.writable
    if (this.enabled.getSnapshot() !== enabled) this.enabled.set(enabled)
    if (this.writable.getSnapshot() !== writable) this.writable.set(writable)
  }
}
