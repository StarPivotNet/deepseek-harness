/** One busy-state delivery selector inside the Subagents Behavior group. */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { IconChevronDownOutlineMedium, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SubagentBusyDelivery } from '../delivery-settings.ts'
import type { SubagentsKey } from './locales.ts'
import css from './DeliveryRow.module.css'

/** Locale lookup used by the row. */
type Translate = (key: SubagentsKey) => string

/** Props for one Behavior selector. */
interface DeliveryRowProps {
  /** Row title. */
  title: string
  /** Row description. */
  description: string
  /** Current busy-state placement. */
  value: SubagentBusyDelivery
  /** Whether the Host document accepts writes. */
  writable: boolean
  /** Persist a new placement. */
  onChange: (behavior: SubagentBusyDelivery) => void
  /** Localized labels. */
  t: Translate
}

const OPTIONS: readonly { id: SubagentBusyDelivery; label: SubagentsKey }[] = [
  { id: 'steer', label: 'delivery.steer' },
  { id: 'queue', label: 'delivery.queue' },
]

/**
 * Render one busy-state delivery selector.
 * @param props - title, current value, and write callback.
 * @returns the preference row.
 */
export function DeliveryRow({
  title, description, value, writable, onChange, t,
}: DeliveryRowProps): ReactNode {
  const [open, setOpen] = useState(false)
  const selectedLabel = value === 'queue' ? 'delivery.queue' : 'delivery.steer'

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{title}</div>
        <div className={css.desc}>{description}</div>
      </div>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={OPTIONS.map(option => ({ id: option.id, label: t(option.label) }))}
        selectedId={value}
        onSelect={(id) => {
          setOpen(false)
          if (!writable) return
          onChange(id as SubagentBusyDelivery)
        }}
        align="end"
        portal
        anchor={(
          <button
            type="button"
            className={css.selector}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-disabled={!writable}
            onClick={() => { setOpen(current => !current) }}
          >
            {t(selectedLabel)}
            <IconChevronDownOutlineMedium className={css.chevron} />
          </button>
        )}
      />
    </div>
  )
}
