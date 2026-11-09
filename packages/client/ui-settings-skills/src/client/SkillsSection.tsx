import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import type { SkillCatalogEntry } from '@deepseek-ai/dsh-api-remotes/client'
import {
  IconChevronDownOutlineMedium,
  IconSearchOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { matchesSkill, sourceLabelKey } from './catalog.ts'
import css from './SkillsSection.module.css'

/** Registration-side Remote face used by the section. */
export interface SkillsSectionInjected {
  /** Read the current Host skill catalog. */
  list: () => Promise<readonly SkillCatalogEntry[]>
}

/** Full component props assembled by the Settings slot renderer. */
export type SkillsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.skills'>
  & InjectFace<SkillsSectionInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly skills: readonly SkillCatalogEntry[] }

/**
 * Localized origin label: a known bucket uses its locale key, an unknown
 * provider source stays verbatim.
 * @param source - catalog origin bucket.
 * @param t - locale reader.
 * @returns the display label.
 */
function sourceLabel(source: string, t: SkillsSectionProps['t']): string {
  const key = sourceLabelKey(source)
  return key === undefined ? source : t(key)
}

/** Render the read-only skill catalog. */
export function SkillsSection({ list, t }: SkillsSectionProps): ReactNode {
  const catalogId = useId()
  const [request, setRequest] = useState(0)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [state, setState] = useState<ViewState>({ status: 'loading' })

  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => list()).then(
      (skills) => { if (current) setState({ status: 'ready', skills }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [list, request])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filtered = useMemo(
    () => state.status === 'ready'
      ? state.skills.filter(skill => matchesSkill(skill, normalizedQuery))
      : [],
    [normalizedQuery, state],
  )

  useEffect(() => {
    if (expanded !== null && !filtered.some(skill => skill.name === expanded)) {
      setExpanded(null)
    }
  }, [expanded, filtered])

  const retry = (): void => {
    setState({ status: 'loading' })
    setRequest(value => value + 1)
  }

  return (
    <div className={css.section} aria-busy={state.status === 'loading'}>
      <h2 className={css.heading}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>
      {state.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
      {state.status === 'error' ? (
        <div className={css.failure}>
          <p role="alert">{t('error')}</p>
          <button type="button" onClick={retry}>{t('retry')}</button>
        </div>
      ) : null}
      {state.status === 'ready' ? (
        <div className={css.catalog}>
          <label className={css.search}>
            <IconSearchOutlineMedium aria-hidden="true" />
            <span className={css.visuallyHidden}>{t('search')}</span>
            <input
              type="search"
              value={query}
              placeholder={t('search')}
              aria-label={t('search')}
              onChange={(event) => { setQuery(event.currentTarget.value) }}
            />
          </label>
          <div className={css.catalogHeading}>
            <h3>{t('catalog')}</h3>
            <span data-skill-count={filtered.length}>{filtered.length}</span>
          </div>
          {state.skills.length === 0 ? <p className={css.status}>{t('empty')}</p> : null}
          {state.skills.length > 0 && filtered.length === 0
            ? <p className={css.status}>{t('emptySearch')}</p>
            : null}
          {filtered.length > 0 ? (
            <ul className={css.cards}>
              {filtered.map((skill) => {
                const open = expanded === skill.name
                const detailId = `${catalogId}-details-${encodeURIComponent(skill.name)}`
                const origin = sourceLabel((skill.source ?? ''), t)
                const model = t(skill.modelInvocable ? 'modelYes' : 'modelNo')
                const user = t((skill.userInvocable === true) ? 'userYes' : 'userNo')
                return (
                  <li
                    className={css.card}
                    key={`${skill.provider}:${skill.name}`}
                    data-skill-name={skill.name}
                    data-skill-source={(skill.source ?? '')}
                    data-open={open ? 'true' : undefined}
                  >
                    <button
                      className={css.cardContent}
                      type="button"
                      aria-expanded={open}
                      aria-controls={detailId}
                      aria-label={`${skill.name}, ${origin}`}
                      onClick={() => {
                        setExpanded((current: string | null) => current === skill.name ? null : skill.name)
                      }}
                    >
                      <span className={css.headText}>
                        <strong className={css.cardTitle}>{skill.name}</strong>
                        <span className={css.description}>{skill.description}</span>
                      </span>
                      <span className={css.cardTrailing}>
                        <span
                          className={css.sourceTag}
                          data-source={(skill.source ?? '')}
                        >
                          {origin}
                        </span>
                        <IconChevronDownOutlineMedium className={css.chevron} size={12} aria-hidden="true" />
                      </span>
                    </button>
                    {open ? (
                      <div className={css.cardDetails} id={detailId}>
                        <dl className={css.details}>
                          <div>
                            <dt>{t('source')}</dt>
                            <dd>{origin}</dd>
                          </div>
                          <div>
                            <dt>{t('provider')}</dt>
                            <dd>{skill.provider}</dd>
                          </div>
                          <div>
                            <dt>{t('model')}</dt>
                            <dd>{model}</dd>
                          </div>
                          <div>
                            <dt>{t('user')}</dt>
                            <dd>{user}</dd>
                          </div>
                        </dl>
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
