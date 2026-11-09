/**
 * System-prompt settings section: the user library and per-model assembly.
 */

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import {
  Button,
  IconChevronDownOutlineMedium,
  IconChevronUpOutlineMedium,
  IconEditOutlineMedium,
  IconPlusOutlineMedium,
  IconTrashOutlineMedium,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { bindingFor, type SystemPromptsState } from './store.ts'
import css from './SystemPromptsSection.module.css'

/** Registration-side business face for the section. */
export interface SystemPromptsSectionInjected {
  hooks: {
    /** Page snapshot bound by the renderer as useSystemPrompts. */
    systemPrompts: SnapshotStore<SystemPromptsState>
  }
  /** Read the library, bindings, and catalog. */
  load: () => Promise<void>
  /** Open a create draft. */
  beginCreate: () => void
  /** Open an edit draft. */
  beginEdit: (id: string) => void
  /** Open an edit draft over a registered plugin section. */
  beginEditBuiltIn: (name: string) => void
  /** Drop the stored replacement for a registered plugin section. */
  resetBuiltIn: (name: string) => Promise<void>
  /** Close the draft dialog. */
  cancelDraft: () => void
  /** Update the draft name. */
  setDraftName: (name: string) => void
  /** Update the draft text. */
  setDraftText: (text: string) => void
  /** Persist the open draft. */
  saveDraft: () => Promise<void>
  /** Ask for delete confirmation, or dismiss it with null. */
  confirmDelete: (id: string | null) => void
  /** Delete the prompt awaiting confirmation. */
  remove: () => Promise<void>
  /** Replace one model's selected prompt ids. */
  setPromptIds: (provider: string, model: string, promptIds: readonly string[]) => Promise<void>
  /** Toggle whether one model replaces the assembled prompt. */
  setOverride: (provider: string, model: string, override: boolean) => Promise<void>
}

/** Full component props. */
export type SystemPromptsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.systemPrompts'>
  & InjectFace<SystemPromptsSectionInjected>

/**
 * Render the System prompts section content column.
 * @param props - composed slot props.
 * @returns the section.
 */
export function SystemPromptsSection(props: SystemPromptsSectionProps): ReactNode {
  const { useSystemPrompts, t, load } = props
  const state = useSystemPrompts(snapshot => snapshot)

  useEffect(() => {
    void load()
  }, [load])

  if (state.status === 'unavailable') {
    return (
      <div className={css.section}>
        <p className={css.empty}>{t('unavailable')}</p>
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className={css.section}>
        <p className={css.error} role="alert">{`${t('error')} ${state.error ?? ''}`}</p>
        <button type="button" className={css.secondaryButton} onClick={() => { void load() }}>
          {t('retry')}
        </button>
      </div>
    )
  }

  const draftError = state.draft?.error
  const draftMessage = draftError === 'nameRequired' || draftError === 'textRequired'
    ? t(draftError)
    : draftError

  return (
    <div className={css.section}>
      <h2 className={css.title}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>
      {state.error === null ? null : <p className={css.error} role="alert">{state.error}</p>}
      {!state.writable && state.status === 'ready' ? <p className={css.empty}>{t('readOnly')}</p> : null}

      <section className={css.group}>
        <h3 className={css.groupHead}>{t('builtInGroup')}</h3>
        {state.builtInError === null ? null : <p className={css.error} role="alert">{t('builtInFailed')}</p>}
        {state.builtIns.length === 0
          ? <p className={css.empty}>{t('emptyBuiltIns')}</p>
          : (
            <ul className={css.cards}>
              {state.builtIns.map(section => (
                <li key={section.name} className={css.card}>
                  <div className={css.cardHead}>
                    <span className={css.cardName}>{section.name}</span>
                    {section.overridden
                      ? <span className={css.cardMeta}>{t('overridden')}</span>
                      : null}
                  </div>
                  <p className={css.cardPreview}>{section.text.length === 0 ? t('emptySection') : section.text}</p>
                  <div className={css.cardFoot}>
                    <button
                      type="button"
                      className={css.iconButton}
                      disabled={!state.writable}
                      aria-label={`${t('edit')}: ${section.name}`}
                      onClick={() => { props.beginEditBuiltIn(section.name) }}
                    >
                      <IconEditOutlineMedium />
                    </button>
                    <button
                      type="button"
                      className={css.secondaryButton}
                      disabled={!state.writable || !section.overridden}
                      onClick={() => { void props.resetBuiltIn(section.name) }}
                    >
                      {t('resetBuiltIn')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </section>

      <section className={css.group}>
        <h3 className={css.groupHead}>{t('libraryGroup')}</h3>
        {state.prompts.length === 0
          ? <p className={css.empty}>{t('emptyLibrary')}</p>
          : (
            <ul className={css.cards}>
              {state.prompts.map(prompt => (
                <li key={prompt.id} className={css.card}>
                  <div className={css.cardHead}>
                    <span className={css.cardName}>{prompt.name}</span>
                  </div>
                  <p className={css.cardPreview}>{prompt.text}</p>
                  <div className={css.cardFoot}>
                    <button
                      type="button"
                      className={css.iconButton}
                      disabled={!state.writable}
                      aria-label={`${t('edit')}: ${prompt.name}`}
                      onClick={() => { props.beginEdit(prompt.id) }}
                    >
                      <IconEditOutlineMedium />
                    </button>
                    <button
                      type="button"
                      className={`${css.iconButton} ${css.iconDanger}`}
                      disabled={!state.writable}
                      aria-label={`${t('delete')}: ${prompt.name}`}
                      onClick={() => { props.confirmDelete(prompt.id) }}
                    >
                      <IconTrashOutlineMedium />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        <button
          type="button"
          className={css.creatorButton}
          disabled={!state.writable}
          onClick={() => { props.beginCreate() }}
        >
          <IconPlusOutlineMedium size={14} />
          {t('addPrompt')}
        </button>
      </section>

      <section className={css.group}>
        <h3 className={css.groupHead}>{t('modelsGroup')}</h3>
        {state.catalogError === null ? null : <p className={css.error} role="alert">{t('catalogFailed')}</p>}
        {state.catalog.length === 0
          ? <p className={css.empty}>{t('emptyModels')}</p>
          : state.catalog.map((entry) => {
            const binding = bindingFor(state.bindings, entry.provider, entry.model)
            const unused = state.prompts.filter(prompt => !binding.promptIds.includes(prompt.id))
            return (
              <div key={`${entry.provider}/${entry.model}`} className={css.modelCard}>
                <div className={css.modelTitle}>
                  <span className={css.modelName}>{entry.modelName}</span>
                  <span className={css.providerName}>{entry.providerName}</span>
                </div>
                <p className={css.cardMeta}>
                  {t('selectedCount').replace('{count}', String(binding.promptIds.length))}
                </p>
                {binding.promptIds.length === 0
                  ? null
                  : (
                    <ul className={css.selected}>
                      {binding.promptIds.map((id, index) => {
                        const prompt = state.prompts.find(row => row.id === id)
                        const label = prompt?.name ?? id
                        return (
                          <li key={id} className={css.selectedRow}>
                            <span className={css.selectedName}>{label}</span>
                            <button
                              type="button"
                              className={css.iconButton}
                              disabled={!state.writable || index === 0}
                              aria-label={`${t('moveUp')}: ${label}`}
                              onClick={() => {
                                const next = [...binding.promptIds]
                                const previous = next[index - 1]
                                const current = next[index]
                                if (previous === undefined || current === undefined) return
                                next[index - 1] = current
                                next[index] = previous
                                void props.setPromptIds(entry.provider, entry.model, next)
                              }}
                            >
                              <IconChevronUpOutlineMedium />
                            </button>
                            <button
                              type="button"
                              className={css.iconButton}
                              disabled={!state.writable || index === binding.promptIds.length - 1}
                              aria-label={`${t('moveDown')}: ${label}`}
                              onClick={() => {
                                const next = [...binding.promptIds]
                                const current = next[index]
                                const following = next[index + 1]
                                if (current === undefined || following === undefined) return
                                next[index] = following
                                next[index + 1] = current
                                void props.setPromptIds(entry.provider, entry.model, next)
                              }}
                            >
                              <IconChevronDownOutlineMedium />
                            </button>
                            <button
                              type="button"
                              className={`${css.iconButton} ${css.iconDanger}`}
                              disabled={!state.writable}
                              aria-label={`${t('removeFromModel')}: ${label}`}
                              onClick={() => {
                                void props.setPromptIds(
                                  entry.provider,
                                  entry.model,
                                  binding.promptIds.filter(promptId => promptId !== id),
                                )
                              }}
                            >
                              <IconTrashOutlineMedium />
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                <label className={css.overrideRow}>
                  <input
                    type="checkbox"
                    checked={binding.override}
                    disabled={!state.writable}
                    onChange={(event) => {
                      void props.setOverride(entry.provider, entry.model, event.target.checked)
                    }}
                  />
                  <span>{t('override')}</span>
                </label>
                <p className={css.overrideHint}>{binding.override ? t('overrideHint') : t('appendHint')}</p>
                <select
                  className={css.addSelect}
                  disabled={!state.writable || unused.length === 0}
                  value=""
                  aria-label={t('addToModel')}
                  onChange={(event) => {
                    const id = event.target.value
                    if (id.length === 0) return
                    void props.setPromptIds(entry.provider, entry.model, [...binding.promptIds, id])
                  }}
                >
                  <option value="">{unused.length === 0 ? t('noPromptsToAdd') : t('addToModel')}</option>
                  {unused.map(prompt => (
                    <option key={prompt.id} value={prompt.id}>{prompt.name}</option>
                  ))}
                </select>
              </div>
            )
          })}
      </section>

      <Modal
        open={state.draft !== null}
        onClose={() => { props.cancelDraft() }}
        title={state.draft?.kind === 'builtin'
          ? t('editBuiltIn')
          : state.draft?.id === null ? t('addPrompt') : t('edit')}
        closeLabel={t('close')}
        className={css.dialog as string}
        footer={(
          <>
            <Button
              variant="outline"
              disabled={state.draft?.saving === true}
              onClick={() => { props.cancelDraft() }}
            >
              {t('cancel')}
            </Button>
            <Button
              disabled={state.draft === null || state.draft.saving}
              onClick={() => { void props.saveDraft() }}
            >
              {state.draft?.saving === true ? t('saving') : t('save')}
            </Button>
          </>
        )}
      >
        {state.draft === null
          ? null
          : (
            <div className={css.dialogFields}>
              {state.draft.kind === 'builtin'
                ? (
                  <p className={css.overrideHint}>{state.draft.name}</p>
                )
                : (
                  <label className={css.field}>
                    <span className={css.fieldLabel}>{t('promptName')}</span>
                    <input
                      className={css.input}
                      value={state.draft.name}
                      autoFocus
                      spellCheck={false}
                      placeholder={t('promptNamePlaceholder')}
                      onChange={(event) => { props.setDraftName(event.target.value) }}
                    />
                  </label>
                )}
              <label className={css.field}>
                <span className={css.fieldLabel}>{t('promptText')}</span>
                <textarea
                  className={css.textarea}
                  value={state.draft.text}
                  spellCheck={false}
                  placeholder={t('promptTextPlaceholder')}
                  onChange={(event) => { props.setDraftText(event.target.value) }}
                />
              </label>
              {draftMessage === null || draftMessage === undefined
                ? null
                : <p className={css.error} role="alert">{draftMessage}</p>}
            </div>
          )}
      </Modal>

      <Modal
        open={state.pendingDelete !== null}
        onClose={() => { props.confirmDelete(null) }}
        title={t('deleteTitle')}
        closeLabel={t('close')}
        description={t('deleteDescription')}
        className={css.deleteDialog as string}
        footer={(
          <>
            <Button
              variant="outline"
              autoFocus
              disabled={state.deleting}
              onClick={() => { props.confirmDelete(null) }}
            >
              {t('cancel')}
            </Button>
            <Button
              variant="outline"
              className={css.deleteConfirm}
              disabled={state.deleting}
              onClick={() => { void props.remove() }}
            >
              {state.deleting ? t('deleting') : t('deleteConfirm')}
            </Button>
          </>
        )}
      />
    </div>
  )
}
