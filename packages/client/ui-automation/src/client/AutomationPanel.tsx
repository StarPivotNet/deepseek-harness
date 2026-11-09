/**
 * Host Automation: New Session sibling trigger plus the center-column page.
 * The Host remains the fact source; this file owns only the create draft.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Button, IconClockOutlineMedium, IconCloseOutlineMedium, IconPlayOutlineMedium, IconPlusOutlineMedium,
  IconRefreshOutlineMedium, IconTrashOutlineMedium, IconWarningOutlineMedium, Input, Modal, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import {
  draftToCreate, EMPTY_DRAFT, formatNextIn, formatSelector, formatState, toggleWeekday,
  type AutomationDraft, type ScheduleKind,
} from './format.ts'
import { NS, type AutomationKey } from './locales.ts'
import type {
  AutomationListedRule, AutomationRuleView, AutomationState, AutomationStore,
} from './store.ts'
import { AUTOMATION_TEMPLATES, applyTemplate, type AutomationTemplate } from './templates.ts'
import { RuleDetail } from './RuleDetail.tsx'
import css from './AutomationPanel.module.css'

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const
const SCHEDULES: readonly ScheduleKind[] = ['after', 'at', 'every', 'clock']

function stateClassOf(state: AutomationRuleView['state']): string {
  switch (state) {
    case 'scheduled': return css.stateScheduled ?? ''
    case 'overdue': return css.stateOverdue ?? ''
    case 'disabled': return css.stateDisabled ?? ''
    /* v8 ignore next 4 -- closed delivery-state union */
    default: {
      const exhaustive: never = state
      return exhaustive
    }
  }
}

function localizeRunFailure(failure: string, t: AutomationPanelProps['t']): string {
  switch (failure) {
    case 'skipped_busy': return t('runNow.skipped')
    case 'failed': return t('runNow.failed')
    case 'missing_session': return t('runNow.missingSession')
    default: return failure
  }
}

/** Registration-side business face. */
export interface AutomationPanelInjected {
  hooks: {
    /** Page snapshot bound by the renderer as useAutomation. */
    automation: SnapshotStore<AutomationState>
    /** Durable keep-awake preference bound as useKeepAwake. */
    keepAwake: SnapshotStore<boolean>
  }
  /** Fetch the rule list when the page first opens. */
  load: () => Promise<void>
  /** Persist one new rule. */
  create: AutomationStore['create']
  /** Persist a sparse patch on one rule. */
  update: AutomationStore['update']
  /** Enable or disable one rule. */
  setEnabled: AutomationStore['setEnabled']
  /** Fire one rule immediately and open the started Session. */
  runNow: AutomationStore['runNow']
  /** Open the latest started Session for a rule. */
  openLastSession: AutomationStore['openLastSession']
  /** Open one fire's Session. */
  openRun: AutomationStore['openRun']
  /** Delete one past run. */
  deleteRun: AutomationStore['deleteRun']
  /** Delete one rule. */
  remove: AutomationStore['remove']
  /** Open one rule's detail pane, or return to the card list. */
  select: AutomationStore['select']
  /** Show the settings or history pane. */
  setDetailTab: AutomationStore['setDetailTab']
  /** Show or hide the center-column page. */
  setPageOpen: (open: boolean) => void
  /** Persist whether a live Host holds an OS sleep assertion. */
  setKeepAwake: (enabled: boolean) => void
}

/** Sidebar trigger props. */
export type AutomationPanelProps =
  PropsRuntime<'sidebar.automation'>
  & PropsLocale<typeof NS>
  & InjectFace<AutomationPanelInjected>

/** Overlay page props: same inject face, no sidebar owner share. */
export type AutomationPageProps =
  PropsLocale<typeof NS>
  & InjectFace<AutomationPanelInjected>
  & {
    useWorkspaces: AutomationPanelProps['useWorkspaces']
    useSessions: AutomationPanelProps['useSessions']
  }

/**
 * Render the sidebar Automation trigger.
 * @param props - composed slot props.
 * @returns the New Session sibling control.
 */
export function AutomationPanel(props: AutomationPanelProps): ReactNode {
  const { wide, useAutomation, setPageOpen, t } = props
  const pageOpen = useAutomation(snapshot => snapshot.pageOpen)
  return (
    <Tooltip label={t('trigger.label')} delayMs={500} disabled={wide}>
      <button
        type="button"
        className={css.trigger}
        aria-pressed={pageOpen}
        aria-label={t('trigger.label')}
        onClick={() => { setPageOpen(!pageOpen) }}
      >
        <IconClockOutlineMedium size={wide ? 14 : 18} />
        {wide && <span className={css.label}>{t('trigger')}</span>}
      </button>
    </Tooltip>
  )
}

/**
 * Render the center-column Automation page while it is open.
 * @param props - injected store face and locale.
 * @returns the full-column page, or null while closed.
 */
export function AutomationPage(props: AutomationPageProps): ReactNode {
  const {
    useAutomation, useKeepAwake, useWorkspaces, useSessions, load, create, update, setEnabled, runNow, openRun,
    deleteRun, remove, select, setDetailTab, setPageOpen, setKeepAwake, t,
  } = props
  const state = useAutomation(snapshot => snapshot)
  const keepAwake = useKeepAwake(value => value)
  const workspaces = useWorkspaces(snapshot => snapshot.items)
  const wasOpen = useRef(false)

  useEffect(() => {
    const opened = state.pageOpen && !wasOpen.current
    wasOpen.current = state.pageOpen
    if (!opened) return
    void load()
  }, [state.pageOpen, load])

  useEffect(() => {
    if (!state.pageOpen) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPageOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [state.pageOpen, setPageOpen])

  if (!state.pageOpen) return null
  return (
    <AutomationPageChrome
      state={state}
      keepAwake={keepAwake}
      workspaces={workspaces}
      useSessions={useSessions}
      load={load}
      create={create}
      update={update}
      setEnabled={setEnabled}
      runNow={runNow}
      openRun={openRun}
      deleteRun={deleteRun}
      remove={remove}
      select={select}
      setDetailTab={setDetailTab}
      setPageOpen={setPageOpen}
      setKeepAwake={setKeepAwake}
      t={t}
    />
  )
}

function AutomationPageChrome({
  state, keepAwake, workspaces, useSessions, load, create, update, setEnabled, runNow, openRun,
  deleteRun, remove, select, setDetailTab, setPageOpen, setKeepAwake, t,
}: {
  state: AutomationState
  keepAwake: boolean
  workspaces: readonly WorkspaceView[]
  useSessions: AutomationPanelProps['useSessions']
  load: () => Promise<void>
  create: AutomationStore['create']
  update: AutomationStore['update']
  setEnabled: AutomationStore['setEnabled']
  runNow: AutomationStore['runNow']
  openRun: AutomationStore['openRun']
  deleteRun: AutomationStore['deleteRun']
  remove: AutomationStore['remove']
  select: AutomationStore['select']
  setDetailTab: AutomationStore['setDetailTab']
  setPageOpen: (open: boolean) => void
  setKeepAwake: (enabled: boolean) => void
  t: AutomationPanelProps['t']
}): ReactNode {
  const [adding, setAdding] = useState(false)
  const [seed, setSeed] = useState<AutomationTemplate | undefined>(undefined)
  const [refreshing, setRefreshing] = useState(false)
  const openCreate = (template?: AutomationTemplate): void => {
    setSeed(template)
    setAdding(true)
  }
  const refresh = (): void => {
    setRefreshing(true)
    void load().finally(() => { setRefreshing(false) })
  }
  return (
    <section className={css.page} aria-label={t('title')}>
      <header className={css.pageHeader}>
        <div className={css.pageHeading}>
          <h1 className={css.pageTitle}>{t('title')}</h1>
          <p className={css.pageIntro}>{t('intro')}</p>
        </div>
        <div className={css.pageTools}>
          {adding
            ? null
            : (
              <>
                <button
                  type="button"
                  className={css.iconButton}
                  aria-label={t('refresh')}
                  disabled={refreshing}
                  onClick={refresh}
                >
                  <IconRefreshOutlineMedium size={16} />
                </button>
                {state.status !== 'error' || state.items.length > 0
                  ? (
                    <Button
                      variant="primary"
                      icon={<IconPlusOutlineMedium size={16} />}
                      onClick={() => { openCreate() }}
                    >
                      {t('add')}
                    </Button>
                  )
                  : null}
              </>
            )}
          <button type="button" className={css.pageClose} aria-label={t('close')} onClick={() => { setPageOpen(false) }}>
            <IconCloseOutlineMedium size={16} />
          </button>
        </div>
      </header>
      <div className={css.pageScroll}>
        <AutomationBody
          state={state}
          keepAwake={keepAwake}
          workspaces={workspaces}
          useSessions={useSessions}
          adding={adding}
          seed={seed}
          onAdd={openCreate}
          onAdded={() => {
            setAdding(false)
            setSeed(undefined)
          }}
          load={load}
          create={create}
          update={update}
          setEnabled={setEnabled}
          runNow={runNow}
          openRun={openRun}
          deleteRun={deleteRun}
          remove={remove}
          select={select}
          setDetailTab={setDetailTab}
          setKeepAwake={setKeepAwake}
          t={t}
        />
      </div>
    </section>
  )
}

interface BodyProps {
  state: AutomationState
  keepAwake: boolean
  workspaces: readonly WorkspaceView[]
  useSessions: AutomationPanelProps['useSessions']
  adding: boolean
  seed: AutomationTemplate | undefined
  onAdd: (template?: AutomationTemplate) => void
  onAdded: () => void
  load: () => Promise<void>
  create: AutomationStore['create']
  update: AutomationStore['update']
  setEnabled: AutomationStore['setEnabled']
  runNow: AutomationStore['runNow']
  openRun: AutomationStore['openRun']
  deleteRun: AutomationStore['deleteRun']
  remove: AutomationStore['remove']
  select: AutomationStore['select']
  setDetailTab: AutomationStore['setDetailTab']
  setKeepAwake: (enabled: boolean) => void
  t: AutomationPanelProps['t']
}

function AutomationBody({
  state, keepAwake, workspaces, useSessions, adding, seed, onAdd, onAdded, load, create, update,
  setEnabled, runNow, openRun, deleteRun, remove, select, setDetailTab, setKeepAwake, t,
}: BodyProps): ReactNode {
  const selected = state.selectedId === null
    ? undefined
    : state.items.find(item => item.rule.id === state.selectedId)
  if (selected !== undefined) {
    return (
      <RuleDetail
        item={selected}
        workspaces={workspaces}
        useSessions={useSessions}
        tab={state.detailTab}
        update={update}
        setEnabled={setEnabled}
        runNow={runNow}
        openRun={openRun}
        deleteRun={deleteRun}
        remove={remove}
        select={select}
        setDetailTab={setDetailTab}
        t={t}
      />
    )
  }
  if (state.status === 'error' && state.items.length === 0) {
    return (
      <div className={css.body}>
        <div className={css.emptyCard}>
          <p className={css.error}>{t('loadFailed') + ': ' + String(state.error)}</p>
          <Button variant="outline" onClick={() => { void load() }}>{t('retry')}</Button>
        </div>
      </div>
    )
  }
  return (
    <div className={css.body}>
      {state.error !== null && <p className={css.notice} role="alert">{state.error}</p>}
      <div className={css.keepAwake}>
        <IconWarningOutlineMedium size={14} />
        <div className={css.keepAwakeCopy}>
          <span>{t('keepAwake')}</span>
          <span className={css.keepAwakeHint}>{t('keepAwake.hint')}</span>
        </div>
        <button
          type="button"
          className={css.switch}
          role="switch"
          aria-checked={keepAwake}
          aria-label={t('keepAwake')}
          onClick={() => { setKeepAwake(!keepAwake) }}
        >
          <span className={css.track} data-on={keepAwake || undefined} aria-hidden="true">
            <span className={css.thumb} />
          </span>
        </button>
      </div>
      {state.items.length === 0 && !adding
        ? (
          <div className={css.emptyCard}>
            <p className={css.empty}>{t('empty')}</p>
            <p className={css.emptyHint}>{t('empty.hint')}</p>
          </div>
        )
        : (
          <section className={css.created} aria-labelledby="automation-created">
            <h2 id="automation-created" className={css.sectionTitle}>{t('created')}</h2>
            <ul className={css.cards}>
              {state.items.map(item => (
                <RuleCard
                  key={item.rule.id}
                  item={item}
                  workspaceTitle={workspaces.find(workspace => workspace.workspaceId === item.rule.workspaceId)?.title}
                  onOpen={() => { select(item.rule.id) }}
                  setEnabled={setEnabled}
                  runNow={runNow}
                  remove={remove}
                  t={t}
                />
              ))}
            </ul>
          </section>
        )}
      {adding
        ? (
          <CreateForm
            workspaces={workspaces}
            seed={seed}
            create={create}
            onClose={onAdded}
            t={t}
          />
        )
        : (
          <TemplateGrid onUse={onAdd} t={t} />
        )}
    </div>
  )
}

function RuleCard({
  item, workspaceTitle, onOpen, setEnabled, runNow, remove, t,
}: {
  item: AutomationListedRule
  workspaceTitle: string | undefined
  onOpen: () => void
  setEnabled: AutomationStore['setEnabled']
  runNow: AutomationStore['runNow']
  remove: AutomationStore['remove']
  t: AutomationPanelProps['t']
}): ReactNode {
  const { rule } = item
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [rowError, setRowError] = useState<string | undefined>(undefined)
  const run = (work: () => Promise<string | undefined>): void => {
    /* v8 ignore next -- the action buttons disable while a mutation is in flight */
    if (busy) return
    setBusy(true)
    setRowError(undefined)
    void work()
      .then((failure) => { if (failure !== undefined) setRowError(localizeRunFailure(failure, t)) })
      .finally(() => { setBusy(false) })
  }
  const stateClass = stateClassOf(rule.state)
  const nextWhen = formatNextIn(rule.nextAt, t)
  return (
    <li className={css.card}>
      <button type="button" className={css.cardHit} onClick={onOpen}>
        <div className={css.cardHead}>
          <div className={css.cardName}>{rule.name}</div>
          <div className={css.cardTask}>{rule.task}</div>
          {workspaceTitle === undefined ? null : <div className={css.cardWorkspace}>{workspaceTitle}</div>}
        </div>
        <div className={css.cardMeta}>
          <span className={[css.scheduleChip, stateClass].join(' ')}>
            <IconClockOutlineMedium size={12} />
            <span className={css.visuallyHidden}>{formatState(rule.state, t)}</span>
            {t('scheduleChip', { schedule: formatSelector(rule.selector, t), when: nextWhen })}
          </span>
          <span className={css.runCount}>
            {item.runCount === undefined
              ? null
              : item.runCount === 0
                ? t('runCount.zero')
                : t('runCount', { n: item.runCount })}
          </span>
        </div>
        {rowError !== undefined && <p className={css.error} role="alert">{rowError}</p>}
      </button>
      <div className={css.cardActions}>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => { run(() => setEnabled(rule.id, !rule.enabled)) }}
        >
          {rule.enabled ? t('disabled') : t('enabled')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          icon={<IconPlayOutlineMedium size={14} />}
          disabled={busy}
          onClick={() => { run(() => runNow(rule.id)) }}
        >
          {t('runNow')}
        </Button>
        <Button
          size="sm"
          icon={<IconTrashOutlineMedium size={14} />}
          disabled={busy}
          onClick={() => { setConfirming(true) }}
        >
          {t('delete')}
        </Button>
      </div>
      <Modal
        open={confirming}
        onClose={() => { setConfirming(false) }}
        title={t('delete.title')}
        closeLabel={t('close')}
        description={t('delete.description')}
        footer={(
          <>
            <Button variant="ghost" disabled={busy} onClick={() => { setConfirming(false) }}>{t('cancel')}</Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                run(async () => {
                  const failure = await remove(rule.id)
                  if (failure === undefined) setConfirming(false)
                  return failure
                })
              }}
            >
              {busy ? t('deleting') : t('delete.confirm')}
            </Button>
          </>
        )}
      />
    </li>
  )
}

function TemplateGrid({
  onUse, t,
}: {
  onUse: (template: AutomationTemplate) => void
  t: AutomationPanelProps['t']
}): ReactNode {
  return (
    <section className={css.templates} aria-labelledby="automation-templates">
      <h2 id="automation-templates" className={css.sectionTitle}>{t('templates')}</h2>
      <ul className={css.templateCards}>
        {AUTOMATION_TEMPLATES.map(template => (
          <li key={template.id} className={css.templateCard}>
            <div className={css.templateCopy}>
              <div className={css.templateTitle}>{t(template.titleKey)}</div>
              <p className={css.templateDescription}>{t(template.descriptionKey)}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => { onUse(template) }}>
              {t('template.use')}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function CreateForm({
  workspaces, seed, initial, submitLabel, hideCancel, create, onPatch, onSave, onClose, t,
}: {
  workspaces: readonly WorkspaceView[]
  seed: AutomationTemplate | undefined
  initial?: AutomationDraft
  submitLabel?: string
  hideCancel?: boolean
  create: AutomationStore['create']
  onPatch?: (next: Partial<AutomationDraft>) => void
  onSave?: () => void
  onClose: () => void
  t: AutomationPanelProps['t']
}): ReactNode {
  const [draft, setDraft] = useState<AutomationDraft>(() => {
    if (initial !== undefined) return initial
    const empty: AutomationDraft = {
      ...EMPTY_DRAFT,
      workspaceId: workspaces[0]?.workspaceId ?? '',
      /* v8 ignore next -- browsers always resolve a timeZone string */
      clockZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    }
    return seed === undefined ? empty : applyTemplate(empty, seed, t)
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const patch = (next: Partial<AutomationDraft>): void => {
    setDraft(current => ({ ...current, ...next }))
    onPatch?.(next)
  }
  const submit = (): void => {
    if (onSave !== undefined) {
      onSave()
      return
    }
    const parsed = draftToCreate(draft, t)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    setBusy(true)
    setError(undefined)
    void create(parsed.input)
      .then((failure) => {
        if (failure !== undefined) {
          setError(failure)
          return
        }
        onClose()
      })
      .finally(() => { setBusy(false) })
  }
  return (
    <form
      className={css.formCard}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('name')}</span>
        <Input
          value={draft.name}
          placeholder={t('name.placeholder')}
          onChange={(event) => { patch({ name: event.target.value }) }}
        />
      </label>
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('task')}</span>
        <textarea
          className={css.textarea}
          value={draft.task}
          placeholder={t('task.placeholder')}
          required
          onChange={(event) => { patch({ task: event.target.value }) }}
        />
      </label>
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('workspace')}</span>
        {workspaces.length === 0
          ? <p className={css.notice}>{t('workspace.empty')}</p>
          : (
            <select
              className={css.select}
              value={draft.workspaceId}
              onChange={(event) => { patch({ workspaceId: event.target.value }) }}
            >
              {workspaces.map(workspace => (
                <option key={workspace.workspaceId} value={workspace.workspaceId}>
                  {workspace.title}
                </option>
              ))}
            </select>
          )}
      </label>
      <fieldset className={css.field}>
        <legend className={css.fieldLabel}>{t('schedule')}</legend>
        <div className={css.schedule}>
          {SCHEDULES.map((kind) => {
            const key = ('schedule.' + kind) as AutomationKey
            return (
              <Button
                key={kind}
                size="sm"
                variant={draft.schedule === kind ? 'primary' : 'outline'}
                aria-pressed={draft.schedule === kind}
                onClick={() => { patch({ schedule: kind }) }}
              >
                {t(key)}
              </Button>
            )
          })}
        </div>
      </fieldset>
      {draft.schedule === 'after' && (
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('after.seconds')}</span>
          <Input
            type="number"
            min={1}
            step={1}
            value={draft.afterSeconds}
            onChange={(event) => { patch({ afterSeconds: event.target.value }) }}
          />
        </label>
      )}
      {draft.schedule === 'at' && (
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('at.instant')}</span>
          <Input
            value={draft.at}
            placeholder="2026-08-16T09:00:00.000Z"
            onChange={(event) => { patch({ at: event.target.value }) }}
          />
        </label>
      )}
      {draft.schedule === 'every' && (
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('every.seconds')}</span>
          <Input
            type="number"
            min={300}
            step={1}
            value={draft.everySeconds}
            onChange={(event) => { patch({ everySeconds: event.target.value }) }}
          />
        </label>
      )}
      {draft.schedule === 'clock' && (
        <>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('clock.time')}</span>
            <Input
              type="time"
              value={draft.clockTime}
              onChange={(event) => { patch({ clockTime: event.target.value }) }}
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('clock.zone')}</span>
            <Input
              aria-label={t('clock.zone')}
              value={draft.clockZone}
              onChange={(event) => { patch({ clockZone: event.target.value }) }}
            />
          </label>
          <fieldset className={css.field}>
            <legend className={css.fieldLabel}>{t('clock.weekdays')}</legend>
            <div className={css.weekdays}>
              {WEEKDAYS.map((day) => {
                const key = ('weekday.' + String(day)) as AutomationKey
                const pressed = draft.weekdays.includes(day)
                return (
                  <Button
                    key={day}
                    size="sm"
                    variant={pressed ? 'primary' : 'outline'}
                    aria-pressed={pressed}
                    onClick={() => { patch({ weekdays: toggleWeekday(draft.weekdays, day) }) }}
                  >
                    {t(key)}
                  </Button>
                )
              })}
            </div>
          </fieldset>
        </>
      )}
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('overlap')}</span>
        <select
          className={css.select}
          value={draft.onOverlap}
          onChange={(event) => { patch({ onOverlap: event.target.value === 'replace' ? 'replace' : 'skip' }) }}
        >
          <option value="skip">{t('overlap.skip')}</option>
          <option value="replace">{t('overlap.replace')}</option>
        </select>
      </label>
      {error !== undefined && <p className={css.error} role="alert">{error}</p>}
      <div className={css.formActions}>
        {hideCancel === true ? null : <Button variant="ghost" disabled={busy} onClick={onClose}>{t('cancel')}</Button>}
        <Button variant="primary" disabled={busy || workspaces.length === 0} onClick={submit}>
          {submitLabel ?? (busy ? t('creating') : t('create'))}
        </Button>
      </div>
    </form>
  )
}
