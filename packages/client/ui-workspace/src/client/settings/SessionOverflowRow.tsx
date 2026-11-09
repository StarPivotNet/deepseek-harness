/** General Settings row for the sidebar Session overflow preference. */
import { useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutlineMedium, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  SESSION_OVERFLOW_ALL, SESSION_OVERFLOW_LIMITS, type SessionOverflowLimit,
} from '../session-overflow.ts'
import type { WorkspaceKey } from '../locales.ts'
import css from './SessionOverflowRow.module.css'

/** Registration-side preference face. */
export interface SessionOverflowRowInjected {
  hooks: {
    /** Persisted overflow preference bound as useSessionOverflowLimit. */
    sessionOverflowLimit: SnapshotStore<SessionOverflowLimit>
  }
  /** Change the overflow step or expand-all preference. */
  setSessionOverflowLimit: (limit: SessionOverflowLimit) => void
}

/** Full Settings-row props. */
export type SessionOverflowRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'workspace'>
  & InjectFace<SessionOverflowRowInjected>

const OPTIONS: readonly {
  id: SessionOverflowLimit
  label: WorkspaceKey
}[] = [
  ...SESSION_OVERFLOW_LIMITS.map(limit => ({
    id: limit,
    label: ('settings.overflow.' + String(limit)) as WorkspaceKey,
  })),
  { id: SESSION_OVERFLOW_ALL, label: 'settings.overflow.all' },
]

/**
 * Render the Session overflow preference selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function SessionOverflowRow({
  useSessionOverflowLimit, setSessionOverflowLimit, t,
}: SessionOverflowRowProps) {
  const limit = useSessionOverflowLimit(value => value)
  const [open, setOpen] = useState(false)
  const selectedLabel = (limit === SESSION_OVERFLOW_ALL
    ? 'settings.overflow.all'
    : ('settings.overflow.' + String(limit))) as WorkspaceKey

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('settings.overflow.title')}</div>
        <div className={css.desc}>{t('settings.overflow.description')}</div>
      </div>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={OPTIONS.map(option => ({ id: String(option.id), label: t(option.label) }))}
        selectedId={String(limit)}
        onSelect={(id) => {
          setOpen(false)
          const next = OPTIONS.find(option => String(option.id) === id)?.id
          if (next !== undefined) setSessionOverflowLimit(next)
        }}
        align="end"
        portal
        anchor={(
          <button
            type="button"
            className={css.selector}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { setOpen(value => !value) }}
          >
            {t(selectedLabel)}
            <IconChevronDownOutlineMedium className={css.chevron} />
          </button>
        )}
      />
    </div>
  )
}
