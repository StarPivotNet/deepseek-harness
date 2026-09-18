// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { UpdateRow, type ProductUpdateUiStatus, type UpdateRowProps } from '../src/client/UpdateRow.tsx'
import { UpdateToast, type UpdateToastProps } from '../src/client/UpdateToast.tsx'
import { en } from '../src/client/locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'


afterEach(cleanup)

const latest = {
  tag: 'dsh-v1.2.4',
  version: '1.2.4',
  url: 'https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v1.2.4',
  notes: 'notes',
}

function mountRow(status: ProductUpdateUiStatus) {
  const checkNow = vi.fn()
  const dismiss = vi.fn()
  const openRelease = vi.fn()
  const props: UpdateRowProps = {
    useStatus: bindSnapshotSelector(createSnapshotStore(status)),
    checkNow,
    dismiss,
    openRelease,
    t: makeTranslate(en),
  }
  render(<UpdateRow {...props} />)
  return { checkNow, dismiss, openRelease }
}

function mountToast(status: ProductUpdateUiStatus) {
  const dismiss = vi.fn()
  const openRelease = vi.fn()
  const props: UpdateToastProps = {
    useStatus: bindSnapshotSelector(createSnapshotStore(status)),
    dismiss,
    openRelease,
    t: makeTranslate(en),
  }
  render(<UpdateToast {...props} />)
  return { dismiss, openRelease }
}

describe('UpdateRow', () => {
  it('explains the check and keeps Check now enabled while idle', () => {
    mountRow({ checking: false, error: false, result: undefined })
    expect(screen.getByText('Product updates')).toBeDefined()
    expect(screen.getByText(/does not download or install/)).toBeDefined()
    expect(screen.getByText('Not checked yet')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Check now' })).toBeDefined()
  })

  it('shows an available update and forwards Check now, Open, and Dismiss', () => {
    const b = mountRow({
      checking: false,
      error: false,
      result: {
        available: true,
        currentVersion: '1.2.3',
        latest,
        checkedAt: 1_700_000_000_000,
        channel: 'dsh',
      },
    })
    expect(screen.getByText('Installed version: 1.2.3')).toBeDefined()
    expect(screen.getByText('Last checked: ' + new Date(1_700_000_000_000).toLocaleString())).toBeDefined()
    expect(screen.getByText('Update available: 1.2.4')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open release notes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(b.checkNow).toHaveBeenCalledOnce()
    expect(b.openRelease).toHaveBeenCalledOnce()
    expect(b.dismiss).toHaveBeenCalledOnce()
  })

  it('disables Check now while checking and reports a failure', () => {
    mountRow({ checking: true, error: false, result: undefined })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Check now' }).disabled).toBe(true)
    expect(screen.getByText('Checking…')).toBeDefined()
    cleanup()
    mountRow({ checking: false, error: true, result: undefined })
    expect(screen.getByText('Could not check for updates.')).toBeDefined()
  })

  it('reports up to date and dismissed states', () => {
    mountRow({
      checking: false,
      error: false,
      result: { available: false, currentVersion: '1.2.3', checkedAt: 1, channel: 'dsh' },
    })
    expect(screen.getByText('You are on the latest release.')).toBeDefined()
    cleanup()
    mountRow({
      checking: false,
      error: false,
      result: { available: false, currentVersion: '1.2.3', latest, checkedAt: 1, channel: 'dsh' },
    })
    expect(screen.getByText('This release was dismissed.')).toBeDefined()
  })
})

describe('UpdateToast', () => {
  it('renders nothing when no update is available', () => {
    mountToast({ checking: false, error: false, result: undefined })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('renders the toast and forwards Open and Dismiss', () => {
    const b = mountToast({
      checking: false,
      error: false,
      result: { available: true, currentVersion: '1.2.3', latest, checkedAt: 1, channel: 'dsh' },
    })
    expect(screen.getByRole('status').textContent).toContain('Version 1.2.4 is available.')
    fireEvent.click(screen.getByRole('button', { name: 'Release notes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(b.openRelease).toHaveBeenCalledOnce()
    expect(b.dismiss).toHaveBeenCalledOnce()
  })
})
