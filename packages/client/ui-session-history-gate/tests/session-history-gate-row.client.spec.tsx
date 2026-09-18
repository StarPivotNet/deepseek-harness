// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { SessionHistoryGateRow } from '../src/client/SessionHistoryGateRow.tsx'
import type { SessionHistoryGateRowProps } from '../src/client/SessionHistoryGateRow.tsx'
import { SessionHistoryGatePreference } from '../src/client/preference.ts'
import type { SessionHistoryToolsSettings } from '../src/client/preference.ts'
import { en } from '../src/client/locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'

afterEach(cleanup)

/** Render the row over a real preference bound to a fresh stubbed scope. */
function mount(options: { enabled?: boolean; writable?: boolean } = {}) {
  const stub = stubSettingsScope<SessionHistoryToolsSettings>()
  stub.publish({
    status: 'ready',
    value: { enabled: options.enabled ?? false },
    revision: 0,
    writable: options.writable ?? true,
  })
  const preference = new SessionHistoryGatePreference(stub.scope)
  const props = {
    useEnabled: bindSnapshotSelector(preference.enabled),
    useWritable: bindSnapshotSelector(preference.writable),
    useSaving: bindSnapshotSelector(preference.saving),
    setEnabled: (enabled) => { preference.setEnabled(enabled) },
    t: makeTranslate(en),
  } as SessionHistoryGateRowProps
  render(<SessionHistoryGateRow {...props} />)
  return { preference, stub, row: screen.getByRole('checkbox', { name: 'Session history tools' }) }
}

describe('SessionHistoryGateRow', () => {
  it('renders the closed default with title and description copy', () => {
    mount()
    expect(screen.getByText('Session history tools')).toBeDefined()
    expect(screen.getByText(en.description)).toBeDefined()
    // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- oxlint narrows this query; tsc does not.
    expect((screen.getByRole('checkbox', { name: 'Session history tools' }) as HTMLInputElement).checked)
      .toBe(false)
  })

  it('renders checked from an enabled scope snapshot and follows later acceptances', () => {
    const b = mount({ enabled: true })
    expect((b.row as HTMLInputElement).checked).toBe(true)
    act(() => {
      b.stub.publish({ status: 'ready', value: { enabled: false }, revision: 1, writable: true })
    })
    expect((b.row as HTMLInputElement).checked).toBe(false)
  })

  it('toggles optimistically and writes the next value to the scope', () => {
    const b = mount()
    fireEvent.click(b.row)
    expect(b.stub.set).toHaveBeenCalledWith('enabled', true)
    expect((b.row as HTMLInputElement).checked).toBe(true)
    expect(b.row.closest('div')?.getAttribute('aria-busy')).toBe('true')
  })

  it('keeps the control enabled and reverts visibly when the write fails to land', async () => {
    const b = mount()
    fireEvent.click(b.row)
    expect((b.row as HTMLInputElement).disabled).toBe(false)
    await vi.waitFor(() => {
      expect(b.row.closest('div')?.getAttribute('aria-busy')).toBeNull()
    })
    expect((b.row as HTMLInputElement).checked).toBe(false)
  })

  it('keeps the landed value after a successful write', async () => {
    const b = mount()
    const accept: SettingsScope<SessionHistoryToolsSettings>['set'] = (_field, value) => {
      b.stub.publish({
        status: 'ready', value: { enabled: value as boolean }, revision: 1, writable: true,
      })
      return Promise.resolve()
    }
    b.stub.set.mockImplementation(accept)
    fireEvent.click(b.row)
    await vi.waitFor(() => {
      expect(b.row.closest('div')?.getAttribute('aria-busy')).toBeNull()
    })
    expect((b.row as HTMLInputElement).checked).toBe(true)
  })

  it('disables the checkbox while the document is not writable', () => {
    const b = mount({ writable: false })
    expect((b.row as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(b.row)
    expect(b.stub.set).not.toHaveBeenCalled()
  })
})
