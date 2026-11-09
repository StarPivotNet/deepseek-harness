/** Plugins marketplace section: discover + installed pages plus Host cards. */

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  IconCloseOutlineMedium,
  IconEditOutlineMedium,
  IconRefreshOutlineMedium,
  IconSearchOutlineMedium,
  IconTrashOutlineMedium,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import { catalogPackageLabel, installedHoverLabel } from './catalog-label.ts'
import { updatedAgoLine, updatedAgoRelative } from './updated-ago.ts'
import { allTags, parseTagInput } from '../shared.ts'
import { confirmInstallMessage } from './confirm-install.ts'
import type { MarketplaceLocaleKey } from './locales.ts'
import css from './MarketplaceSettingsSection.module.css'

/** Catalog listing projected for the discover page. */
export interface MarketplaceCatalogItem {
  readonly name: string
  readonly version: string
  readonly title: string
  readonly description: string
  readonly homepage: string
  readonly kind: 'bundle' | 'plugin'
  readonly sourceUrl: string
  readonly sourceTitle: string
  readonly updatedAt?: string
}

export interface MarketplaceCatalogSource {
  readonly url: string
  readonly title: string
  readonly ok: boolean
  readonly error?: string
  readonly count: number
}

/** Installed row projected for the installed page. */
export interface MarketplaceInstalledItem {
  readonly packageName: string
  readonly spec: string
  readonly kind: 'bundle' | 'dependency' | 'inbox'
  readonly installed: boolean
  readonly entryIds: readonly string[]
  readonly enabled: boolean
  readonly fiberPhase: string | null
  readonly canUninstall: boolean
  readonly canToggle: boolean
  readonly note: string
  readonly tags: readonly string[]
}

/** Catalog snapshot the Host returns. */
export interface MarketplaceCatalogSnapshot {
  readonly configured: boolean
  readonly sources: readonly MarketplaceCatalogSource[]
  readonly entries: readonly MarketplaceCatalogItem[]
  readonly fetchedAt?: number
  readonly stale?: boolean
  readonly refreshing?: boolean
}

/** Result of a mutating marketplace call. */
export interface MarketplaceMutationResult {
  readonly ok: boolean
  readonly restartRequired?: boolean
  readonly message?: string
}

/** Registration-side Remote face used by the section. */
export interface MarketplaceSettingsSectionInjected {
  listInstalled: () => Promise<{ profileName: string; entries: readonly MarketplaceInstalledItem[] }>
  listCatalog: () => Promise<MarketplaceCatalogSnapshot>
  refreshCatalog: (url?: string) => Promise<MarketplaceCatalogSnapshot>
  install: (name: string, version?: string) => Promise<MarketplaceMutationResult>
  uninstall: (name: string) => Promise<MarketplaceMutationResult>
  setEnabled: (entryId: string, enabled: boolean) => Promise<MarketplaceMutationResult>
  setPluginNote: (name: string, note: string, tags: readonly string[]) => Promise<MarketplaceMutationResult>
  catalogUrls: readonly string[]
  setCatalogUrls: (value: readonly string[]) => Promise<void>
}

/** Full component props assembled by the Settings slot renderer. */
export type MarketplaceSettingsSectionProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.pluginMarketplace'>
  & InjectFace<MarketplaceSettingsSectionInjected>

type TabId = 'discover' | 'installed'

type ViewState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly value: T }

/** Whether a listing matches the local query. */
function matches(haystacks: readonly string[], query: string): boolean {
  if (query.length === 0) return true
  return haystacks.some(value => value.toLocaleLowerCase().includes(query))
}

function requestInstall(
  t: MarketplaceSettingsSectionProps['t'],
  entry: MarketplaceCatalogItem,
  onInstall: (name: string, version?: string) => void,
): void {
  if (globalThis.confirm(confirmInstallMessage(t, entry))) {
    onInstall(entry.name, entry.version.length > 0 ? entry.version : undefined)
  }
}

function installedKindLabel(
  t: MarketplaceSettingsSectionProps['t'],
  kind: MarketplaceInstalledItem['kind'],
): string {
  return t(kind === 'inbox' ? 'inboxTag' : kind === 'bundle' ? 'bundleTag' : 'dependencyTag')
}

type InstalledTagFilter =
  | { readonly mode: 'all' }
  | { readonly mode: 'untagged' }
  | { readonly mode: 'tag'; readonly tag: string }

function notesMap(entries: readonly MarketplaceInstalledItem[]): Record<string, { note: string; tags: readonly string[] }> {
  return Object.fromEntries(entries.map(entry => [entry.packageName, { note: entry.note, tags: entry.tags }]))
}

function mergeTags(current: readonly string[], raw: string): string[] {
  return parseTagInput([...current, raw].join(','))
}

function resolveTagFilter(
  filter: InstalledTagFilter,
  tags: readonly string[],
): InstalledTagFilter {
  if (filter.mode !== 'tag') return filter
  return tags.some(tag => tag.toLocaleLowerCase() === filter.tag.toLocaleLowerCase())
    ? filter
    : { mode: 'all' }
}

/** Render the marketplace Plugins section. */
export function MarketplaceSettingsSection({
  t, listInstalled, listCatalog, refreshCatalog, install, uninstall,
  setEnabled, setPluginNote, catalogUrls, setCatalogUrls,
}: MarketplaceSettingsSectionProps): ReactNode {
  const tabsId = useId()
  const [tab, setTab] = useState<TabId>('discover')
  const [query, setQuery] = useState('')
  const [restart, setRestart] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [draftUrls, setDraftUrls] = useState<string[]>([...catalogUrls])
  const [savingUrl, setSavingUrl] = useState(false)
  const [refreshingUrl, setRefreshingUrl] = useState<string | 'all' | null>(null)
  const [busyName, setBusyName] = useState<string | null>(null)
  const [installedRequest, setInstalledRequest] = useState(0)
  const [catalog, setCatalog] = useState<ViewState<MarketplaceCatalogSnapshot>>({ status: 'loading' })
  const [installed, setInstalled] = useState<ViewState<readonly MarketplaceInstalledItem[]>>({ status: 'loading' })

  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => listCatalog()).then(
      (snapshot) => {
        if (!current) return
        setCatalog({ status: 'ready', value: snapshot })
        setRefreshingUrl('all')
        void refreshCatalog().then(
          (fresh) => { if (current) setCatalog({ status: 'ready', value: fresh }) },
          () => {
            if (!current) return
            if (snapshot.entries.length === 0) setNotice(t('error'))
          },
        ).finally(() => { if (current) setRefreshingUrl(null) })
      },
      () => { if (current) setCatalog({ status: 'error' }) },
    )
    return () => { current = false }
  }, [listCatalog, refreshCatalog])

  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => listInstalled()).then(
      (snapshot) => { if (current) setInstalled({ status: 'ready', value: snapshot.entries }) },
      () => { if (current) setInstalled({ status: 'error' }) },
    )
    return () => { current = false }
  }, [listInstalled, installedRequest])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const catalogEntries = catalog.status === 'ready' ? catalog.value.entries : []
  const installedEntries = installed.status === 'ready' ? installed.value : []
  const installedNames = useMemo(
    () => new Set(installedEntries.map(entry => entry.packageName)),
    [installedEntries],
  )
  const filteredCatalog = catalogEntries.filter(entry => matches([entry.name, entry.title, entry.description], normalizedQuery))
  const filteredInstalled = installedEntries.filter(entry => matches([
    entry.packageName,
    entry.spec,
    entry.note,
    ...entry.tags,
  ], normalizedQuery))

  const refreshCatalogNow = async (url?: string): Promise<void> => {
    setRefreshingUrl(url ?? 'all')
    setNotice(null)
    try {
      const snapshot = await refreshCatalog(url)
      setCatalog({ status: 'ready', value: snapshot })
    } catch {
      setNotice(t('error'))
    } finally {
      setRefreshingUrl(null)
    }
  }

  const refreshAll = (): void => {
    setInstalled({ status: 'loading' })
    setInstalledRequest(value => value + 1)
    void refreshCatalogNow()
  }

  const refreshInstalled = (): void => {
    setInstalledRequest(value => value + 1)
  }

  const applyInstalledNote = (name: string, note: string, tags: readonly string[]): void => {
    setInstalled((current) => {
      if (current.status !== 'ready') return current
      return {
        status: 'ready',
        value: current.value.map(entry => entry.packageName === name ? { ...entry, note, tags } : entry),
      }
    })
  }

  const runMutation = async (
    name: string,
    work: () => Promise<MarketplaceMutationResult>,
    options: { readonly keepList?: boolean } = {},
  ): Promise<boolean> => {
    setBusyName(name)
    setNotice(null)
    const result = await work()
    setBusyName(null)
    if (!result.ok) {
      setNotice(result.message ?? t('error'))
      return false
    }
    if (result.restartRequired === true) setRestart(true)
    if (options.keepList === true) refreshInstalled()
    else refreshAll()
    return true
  }

  return (
    <div className={css.section} aria-busy={refreshingUrl !== null || installed.status === 'loading'}>
      <h2 className={css.heading}>{t('title')}</h2>
      {restart ? <p className={css.restart} role="status">{t('restart')}</p> : null}
      {notice !== null ? <p className={css.failure} role="alert">{notice}</p> : null}
      <div className={css.tabs} role="tablist" aria-label={t('tabs')}>
        {(['discover', 'installed'] as const).map((id) => {
          const selected = tab === id
          const label = id === 'discover' ? 'discoverTab' : 'installedTab'
          return (
            <button
              key={id}
              id={`${tabsId}-tab-${id}`}
              type="button"
              role="tab"
              className={css.tab}
              aria-selected={selected}
              aria-controls={`${tabsId}-panel-${id}`}
              data-active={selected ? 'true' : undefined}
              onClick={() => { setTab(id) }}
            >
              {t(label)}
            </button>
          )
        })}
      </div>
      <div
        id={`${tabsId}-panel-${tab}`}
        className={css.panel}
        role="tabpanel"
        aria-labelledby={`${tabsId}-tab-${tab}`}
      >
        {tab !== 'installed' ? (
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
        ) : null}
        {tab === 'discover' ? (
          <DiscoverPage
            t={t}
            catalog={catalog}
            filtered={filteredCatalog}
            installedNames={installedNames}
            busyName={busyName}
            draftUrls={draftUrls}
            savingUrl={savingUrl}
            refreshingUrl={refreshingUrl}
            onDraftUrls={setDraftUrls}
            onSaveUrl={async (nextUrls) => {
              setSavingUrl(true)
              const urls = (nextUrls ?? draftUrls).map(url => url.trim()).filter(url => url.length > 0)
              await setCatalogUrls(urls)
              setDraftUrls(urls)
              setSavingUrl(false)
              await refreshCatalogNow()
            }}
            onRefresh={url => void refreshCatalogNow(url)}
            onRetry={() => { void refreshCatalogNow() }}
            onInstall={(name, version) => void runMutation(name, () => install(name, version))}
          />
        ) : null}
        {tab === 'installed' ? (
          <InstalledPage
            t={t}
            installed={installed}
            filtered={filteredInstalled}
            busyName={busyName}
            onRetry={() => {
              setInstalled({ status: 'loading' })
              setInstalledRequest(value => value + 1)
            }}
            onUninstall={name => void runMutation(name, () => uninstall(name))}
            onToggle={(entryId, enabled, packageName) => void runMutation(packageName, () => setEnabled(entryId, enabled))}
            onSaveNote={async (name, note, tags) => {
              applyInstalledNote(name, note, tags)
              const ok = await runMutation(name, () => setPluginNote(name, note, tags), { keepList: true })
              if (!ok) refreshInstalled()
              return ok
            }}
          />
        ) : null}
      </div>
    </div>
  )
}

/** Discover tab body. */
function DiscoverPage(props: {
  t: MarketplaceSettingsSectionProps['t']
  catalog: ViewState<MarketplaceCatalogSnapshot>
  filtered: readonly MarketplaceCatalogItem[]
  installedNames: ReadonlySet<string>
  busyName: string | null
  draftUrls: readonly string[]
  savingUrl: boolean
  refreshingUrl: string | 'all' | null
  onDraftUrls: (value: string[]) => void
  onSaveUrl: (urls?: readonly string[]) => void
  onRefresh: (url?: string) => void
  onRetry: () => void
  onInstall: (name: string, version?: string) => void
}): ReactNode {
  const { t } = props
  const [details, setDetails] = useState<MarketplaceCatalogItem | null>(null)
  const [adding, setAdding] = useState(false)
  const [addUrl, setAddUrl] = useState('')
  const [editing, setEditing] = useState<{ readonly from: string; readonly value: string } | null>(null)
  const addRef = useRef<HTMLInputElement | null>(null)
  const sources = props.catalog.status === 'ready' ? props.catalog.value.sources : []
  useEffect(() => {
    if (adding) addRef.current?.focus()
  }, [adding])
  const savedUrls = (): string[] => {
    const listed = sources.map(source => source.url)
    if (listed.length > 0) return listed
    return props.draftUrls.map(url => url.trim()).filter(url => url.length > 0)
  }
  const commitUrls = (urls: readonly string[]): void => {
    const next = urls.map(url => url.trim()).filter(url => url.length > 0)
    props.onDraftUrls(next)
    props.onSaveUrl(next)
  }
  const removeSource = (url: string): void => {
    if (!globalThis.confirm(t('confirmRemoveMarket'))) return
    commitUrls(savedUrls().filter(item => item !== url))
  }
  return (
    <>
      <div className={css.field}>
        <span id="marketplace-catalog-urls">{t('markets')}</span>
        {adding ? (
          <div className={css.marketRow}>
            <input
              ref={addRef}
              aria-labelledby="marketplace-catalog-urls"
              placeholder={t('marketUrl')}
              value={addUrl}
              onChange={(event) => { setAddUrl(event.currentTarget.value) }}
            />
            <button
              type="button"
              className={css.button}
              disabled={props.savingUrl || addUrl.trim().length === 0}
              onClick={() => {
                commitUrls([...savedUrls(), addUrl])
                setAddUrl('')
                setAdding(false)
              }}
            >
              {props.savingUrl ? t('catalogSaving') : t('catalogSave')}
            </button>
            <button
              type="button"
              className={css.button}
              onClick={() => {
                setAdding(false)
                setAddUrl('')
              }}
            >
              {t('cancel')}
            </button>
          </div>
        ) : null}
        <div className={css.actions}>
          <button
            type="button"
            className={css.button}
            onClick={() => {
              setAdding(true)
              setAddUrl('')
            }}
          >
            {t('addMarket')}
          </button>
          <button
            type="button"
            className={css.button}
            disabled={props.refreshingUrl !== null}
            onClick={() => { props.onRefresh() }}
          >
            {props.refreshingUrl === 'all' ? t('refreshingCatalog') : t('refreshCatalog')}
          </button>
        </div>
      </div>
      {sources.length > 0 ? (
        <ul className={css.sources}>
          {sources.map((source) => {
            const sourceRefreshing = props.refreshingUrl === source.url || props.refreshingUrl === 'all'
            return (
              <li key={source.url} className={css.source} data-ok={source.ok ? 'true' : 'false'}>
                <div className={css.sourceMain}>
                  <strong>{source.title}</strong>
                  {source.ok
                    ? <span>{source.count}</span>
                    : <span>{t('marketFailed')}{source.error !== undefined ? `: ${source.error}` : ''}</span>}
                </div>
                <div className={css.sourceActions}>
                  <Tooltip label={t('refreshMarket')} side="bottom">
                    <button
                      type="button"
                      className={css.iconButton}
                      aria-label={t('refreshMarket')}
                      disabled={props.refreshingUrl !== null}
                      onClick={() => { props.onRefresh(source.url) }}
                    >
                      <IconRefreshOutlineMedium className={sourceRefreshing ? css.spin : undefined} size={14} />
                    </button>
                  </Tooltip>
                  <Tooltip label={t('editMarket')} side="bottom">
                    <button
                      type="button"
                      className={css.iconButton}
                      aria-label={t('editMarket')}
                      onClick={() => { setEditing({ from: source.url, value: source.url }) }}
                    >
                      <IconEditOutlineMedium size={14} />
                    </button>
                  </Tooltip>
                  <Tooltip label={t('removeMarket')} side="bottom">
                    <button
                      type="button"
                      className={css.iconButton}
                      aria-label={t('removeMarket')}
                      disabled={props.savingUrl}
                      onClick={() => { removeSource(source.url) }}
                    >
                      <IconTrashOutlineMedium size={14} />
                    </button>
                  </Tooltip>
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}
      {props.catalog.status === 'loading' && props.refreshingUrl === null ? <p className={css.status}>{t('loading')}</p> : null}
      {props.catalog.status === 'error' ? (
        <div className={css.failure}>
          <p role="alert">{t('error')}</p>
          <button type="button" className={css.button} onClick={props.onRetry}>{t('retry')}</button>
        </div>
      ) : null}
      {props.refreshingUrl !== null && props.catalog.status === 'ready' && props.catalog.value.entries.length === 0
        ? <p className={css.status}>{t('refreshingCatalog')}</p>
        : null}
      {props.catalog.status === 'ready' && !props.catalog.value.configured
        ? <p className={css.empty}>{t('catalogUnconfigured')}</p>
        : null}
      {props.catalog.status === 'ready' && props.catalog.value.configured && props.catalog.value.entries.length === 0
        ? <p className={css.empty}>{t('catalogEmpty')}</p>
        : null}
      {props.catalog.status === 'ready' && props.catalog.value.entries.length > 0 && props.filtered.length === 0
        ? <p className={css.empty}>{t('emptySearch')}</p>
        : null}
      {props.filtered.length > 0 ? (
        <>
          <div className={css.headingRow}>
            <h3>{t('catalog')}</h3>
            <span>{props.filtered.length}</span>
          </div>
          <ul className={`${css.cards} ${css.catalogCards}`}>
            {props.filtered.map((entry) => {
              const already = props.installedNames.has(entry.name)
              const packageLabel = catalogPackageLabel(entry.name, entry.version)
              const installing = props.busyName === entry.name
              const updated = updatedAgoLine(t, entry.updatedAt, Date.now())
              return (
                <li className={`${css.card} ${css.catalogCard}`} key={entry.name} data-plugin-name={entry.name}>
                  <div className={css.cardBody}>
                    <Tooltip
                      label={entry.description}
                      side="bottom"
                      maxWidth={280}
                      disabled={entry.description.length === 0}
                    >
                      <button
                        type="button"
                        className={css.cardHit}
                        aria-haspopup="dialog"
                        aria-label={t('openDetailsNamed', { title: entry.title })}
                        onClick={() => { setDetails(entry) }}
                      >
                        {already
                          ? <span className={css.tag}>{t('installedTag')}</span>
                          : <span className={css.tag}>{entry.sourceTitle}</span>}
                        <h3 className={css.cardTitle}>{entry.title}</h3>
                        <p className={css.packageName}>{packageLabel}</p>
                        <span className={css.description}>{entry.description}</span>
                        {updated !== undefined ? <span className={css.updatedAt}>{updated}</span> : null}
                      </button>
                    </Tooltip>
                  </div>
                  <div className={css.cardAside}>
                    <button
                      type="button"
                      className={css.button}
                      disabled={already || installing}
                      onClick={() => { requestInstall(t, entry, props.onInstall) }}
                    >
                      {installing ? t('installing') : t('install')}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
          {details !== null ? (
            <CatalogDetailsDialog
              t={t}
              entry={details}
              already={props.installedNames.has(details.name)}
              installing={props.busyName === details.name}
              onClose={() => { setDetails(null) }}
              onInstall={() => { requestInstall(t, details, props.onInstall) }}
            />
          ) : null}
        </>
      ) : null}
      {editing !== null ? (
        <DetailsDialog
          t={t}
          title={t('editMarket')}
          rows={[]}
          onClose={() => { setEditing(null) }}
          actions={(
            <button
              type="button"
              className={css.button}
              disabled={props.savingUrl || editing.value.trim().length === 0}
              onClick={() => {
                commitUrls(savedUrls().map(url => url === editing.from ? editing.value : url))
                setEditing(null)
              }}
            >
              {props.savingUrl ? t('catalogSaving') : t('catalogSave')}
            </button>
          )}
        >
          <label className={css.field}>
            <span>{t('marketUrl')}</span>
            <input
              value={editing.value}
              placeholder={t('marketUrl')}
              onChange={(event) => { setEditing({ from: editing.from, value: event.currentTarget.value }) }}
            />
          </label>
        </DetailsDialog>
      ) : null}
    </>
  )
}

/** Installed tab body. */
function InstalledPage(props: {
  t: MarketplaceSettingsSectionProps['t']
  installed: ViewState<readonly MarketplaceInstalledItem[]>
  filtered: readonly MarketplaceInstalledItem[]
  busyName: string | null
  onRetry: () => void
  onUninstall: (name: string) => void
  onToggle: (entryId: string, enabled: boolean, packageName: string) => void
  onSaveNote: (name: string, note: string, tags: readonly string[]) => Promise<boolean>
}): ReactNode {
  const { t } = props
  const [detailsName, setDetailsName] = useState<string | null>(null)
  const [kindFilter, setKindFilter] = useState<'all' | MarketplaceInstalledItem['kind']>('all')
  const [tagFilter, setTagFilter] = useState<InstalledTagFilter>({ mode: 'all' })
  const listed = props.installed.status === 'ready' ? props.installed.value : []
  const tags = allTags(notesMap(listed))
  const activeTagFilter = resolveTagFilter(tagFilter, tags)
  const untaggedCount = listed.filter(entry => entry.tags.length === 0).length
  const visible = props.filtered.filter((entry) => {
    if (kindFilter !== 'all' && entry.kind !== kindFilter) return false
    if (activeTagFilter.mode === 'untagged') return entry.tags.length === 0
    if (activeTagFilter.mode === 'tag') {
      return entry.tags.some(tag => tag.toLocaleLowerCase() === activeTagFilter.tag.toLocaleLowerCase())
    }
    return true
  })
  const details = detailsName === null
    ? null
    : listed.find(entry => entry.packageName === detailsName) ?? null
  return (
    <>
      {props.installed.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
      {props.installed.status === 'error' ? (
        <div className={css.failure}>
          <p role="alert">{t('error')}</p>
          <button type="button" className={css.button} onClick={props.onRetry}>{t('retry')}</button>
        </div>
      ) : null}
      {props.installed.status === 'ready' && props.installed.value.length === 0
        ? <p className={css.empty}>{t('installedEmpty')}</p>
        : null}
      {props.installed.status === 'ready' && props.installed.value.length > 0 ? (
        <>
          <div className={css.headingRow}>
            <h3>{t('installedHeading')}</h3>
            <span>{visible.length}</span>
          </div>
          <div className={css.filters} role="group" aria-label={t('installedHeading')}>
            {([
              ['all', t('filterAll')],
              ['inbox', t('filterInbox')],
              ['bundle', t('filterBundle')],
              ['dependency', t('filterDependency')],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={css.filter}
                data-active={kindFilter === id ? 'true' : undefined}
                onClick={() => { setKindFilter(id) }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className={css.filters} role="group" aria-label={t('filterTags')}>
            <button
              type="button"
              className={css.filter}
              data-active={activeTagFilter.mode === 'all' ? 'true' : undefined}
              onClick={() => { setTagFilter({ mode: 'all' }) }}
            >
              {t('filterAllTags')}
            </button>
            <button
              type="button"
              className={css.filter}
              data-active={activeTagFilter.mode === 'untagged' ? 'true' : undefined}
              onClick={() => { setTagFilter({ mode: 'untagged' }) }}
            >
              {t('filterUntagged')}
              {untaggedCount > 0 ? ` ${untaggedCount}` : ''}
            </button>
            {tags.map(tag => (
              <button
                key={tag}
                type="button"
                className={css.filter}
                data-active={activeTagFilter.mode === 'tag'
                  && activeTagFilter.tag.toLocaleLowerCase() === tag.toLocaleLowerCase() ? 'true' : undefined}
                onClick={() => {
                  setTagFilter(current => (
                    current.mode === 'tag' && current.tag.toLocaleLowerCase() === tag.toLocaleLowerCase()
                      ? { mode: 'all' }
                      : { mode: 'tag', tag }
                  ))
                }}
              >
                {tag}
              </button>
            ))}
          </div>
          {tags.length === 0 ? <p className={css.hint}>{t('tagsIntro')}</p> : null}
          {visible.length === 0 ? <p className={css.empty}>{t('emptySearch')}</p> : (
            <>
              <ul className={`${css.cards} ${css.catalogCards}`}>
                {visible.map((entry) => {
                  const busy = props.busyName === entry.packageName
                  return (
                    <li className={`${css.card} ${css.catalogCard}`} key={entry.packageName} data-plugin-name={entry.packageName}>
                      <div className={css.cardBody}>
                        <Tooltip label={installedHoverLabel(entry.packageName, entry.spec)} side="bottom" maxWidth={360}>
                          <button
                            type="button"
                            className={css.cardHit}
                            aria-haspopup="dialog"
                            aria-label={t('openDetailsNamed', { title: entry.packageName })}
                            onClick={() => { setDetailsName(entry.packageName) }}
                          >
                            <span className={css.tag}>{installedKindLabel(t, entry.kind)}</span>
                            <h3 className={css.cardTitle}>{entry.packageName}</h3>
                            {entry.spec.length > 0 ? <p className={css.packageName}>{entry.spec}</p> : null}
                            {entry.note.length > 0 ? <p className={css.notePreview}>{entry.note}</p> : null}
                          </button>
                        </Tooltip>
                        {entry.tags.length > 0 ? (
                          <div className={css.tagRow}>
                            {entry.tags.map(tag => (
                              <button
                                type="button"
                                className={css.noteTag}
                                data-filter="true"
                                key={tag}
                                onClick={() => { setTagFilter({ mode: 'tag', tag }) }}
                              >
                                {tag}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div className={css.cardAside}>
                        {entry.canToggle && entry.entryIds[0] !== undefined ? (
                          <button
                            type="button"
                            className={css.button}
                            disabled={busy}
                            onClick={() => {
                              const entryId = entry.entryIds[0]
                              if (entryId === undefined) return
                              props.onToggle(entryId, !entry.enabled, entry.packageName)
                            }}
                          >
                            {entry.enabled ? t('disable') : t('enable')}
                          </button>
                        ) : null}
                        {entry.canUninstall ? (
                          <button
                            type="button"
                            className={css.button}
                            disabled={busy}
                            onClick={() => {
                              if (globalThis.confirm(t('confirmUninstall'))) props.onUninstall(entry.packageName)
                            }}
                          >
                            {busy ? t('uninstalling') : t('uninstall')}
                          </button>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
              {details !== null ? (
                <InstalledDetailsDialog
                  t={t}
                  entry={details}
                  knownTags={tags}
                  busy={props.busyName === details.packageName}
                  onClose={() => { setDetailsName(null) }}
                  onToggle={(entryId) => {
                    props.onToggle(entryId, !details.enabled, details.packageName)
                  }}
                  onUninstall={() => {
                    if (globalThis.confirm(t('confirmUninstall'))) props.onUninstall(details.packageName)
                  }}
                  onSaveNote={(note, tags) => props.onSaveNote(details.packageName, note, tags)}
                />
              ) : null}
            </>
          )}
        </>
      ) : null}
    </>
  )
}

function DetailsDialog(props: {
  t: MarketplaceSettingsSectionProps['t']
  title: string
  rows: readonly {
    readonly label: string
    readonly value: string
    readonly href?: string
    readonly mono?: boolean
  }[]
  description?: string
  children?: ReactNode
  onClose: () => void
  actions: ReactNode
}): ReactNode {
  const { t } = props
  const closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(props.onClose)
  onCloseRef.current = props.onClose
  useEffect(() => {
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopImmediatePropagation()
      onCloseRef.current()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => { document.removeEventListener('keydown', onKeyDown, true) }
  }, [])
  return createPortal((
    <div className={css.dialogRoot} role="presentation">
      <div className={css.dialogMask} aria-hidden="true" onClick={props.onClose} />
      <div
        className={css.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="marketplace-plugin-details-title"
      >
        <div className={css.dialogHeader}>
          <h2 className={css.dialogTitle} id="marketplace-plugin-details-title">{props.title}</h2>
          <button
            ref={closeRef}
            type="button"
            className={css.dialogClose}
            aria-label={t('closeDetails')}
            onClick={props.onClose}
          >
            <IconCloseOutlineMedium size={14} />
          </button>
        </div>
        <dl className={css.dialogMeta}>
          {props.rows.map(row => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>
                {row.href !== undefined
                  ? <a href={row.href} target="_blank" rel="noreferrer">{row.value}</a>
                  : row.mono === true
                    ? <code className={css.dialogCode}>{row.value}</code>
                    : row.value}
              </dd>
            </div>
          ))}
        </dl>
        {props.description !== undefined
          ? <p className={css.dialogDescription}>{props.description}</p>
          : null}
        {props.children}
        <div className={css.dialogFooter}>
          <button type="button" className={css.button} onClick={props.onClose}>{t('closeDetails')}</button>
          {props.actions}
        </div>
      </div>
    </div>
  ), document.body)
}

function CatalogDetailsDialog(props: {
  t: MarketplaceSettingsSectionProps['t']
  entry: MarketplaceCatalogItem
  already: boolean
  installing: boolean
  onClose: () => void
  onInstall: () => void
}): ReactNode {
  const { t, entry } = props
  const updated = updatedAgoRelative(t, entry.updatedAt, Date.now())
  const rows = [
    { label: t('detailsPackage'), value: catalogPackageLabel(entry.name, entry.version), mono: true },
    { label: t('detailsKind'), value: t(entry.kind === 'bundle' ? 'bundleTag' : 'pluginTag') },
    { label: t('detailsSource'), value: entry.sourceTitle },
    ...updated !== undefined ? [{ label: t('updatedAtLabel'), value: updated }] : [],
    ...entry.homepage.length > 0
      ? [{ label: t('detailsHomepage'), value: entry.homepage, href: entry.homepage }]
      : [],
  ]
  return (
    <DetailsDialog
      t={t}
      title={entry.title}
      rows={rows}
      description={entry.description.length > 0 ? entry.description : t('detailsNoDescription')}
      onClose={props.onClose}
      actions={(
        <button
          type="button"
          className={css.button}
          disabled={props.already || props.installing}
          onClick={props.onInstall}
        >
          {props.already ? t('installedTag') : props.installing ? t('installing') : t('install')}
        </button>
      )}
    />
  )
}

function InstalledDetailsDialog(props: {
  t: MarketplaceSettingsSectionProps['t']
  entry: MarketplaceInstalledItem
  knownTags: readonly string[]
  busy: boolean
  onClose: () => void
  onToggle: (entryId: string) => void
  onUninstall: () => void
  onSaveNote: (note: string, tags: readonly string[]) => Promise<boolean>
}): ReactNode {
  const { t, entry } = props
  const [note, setNote] = useState(entry.note)
  const [tags, setTags] = useState<readonly string[]>(entry.tags)
  const [tagDraft, setTagDraft] = useState('')
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    if (dirty) return
    setNote(entry.note)
    setTags(entry.tags)
    setTagDraft('')
  }, [dirty, entry.note, entry.packageName, entry.tags])
  const commitDraft = (): void => {
    const next = mergeTags(tags, tagDraft)
    if (next.length === tags.length && tagDraft.trim().length === 0) return
    setTags(next)
    setTagDraft('')
    setDirty(true)
  }
  const rows = [
    { label: t('detailsPackage'), value: entry.packageName, mono: true },
    { label: t('detailsKind'), value: installedKindLabel(t, entry.kind) },
    ...entry.spec.length > 0 ? [{ label: t('detailsSpec'), value: entry.spec, mono: true }] : [],
    { label: t('detailsStatus'), value: entry.enabled ? t('enabledTag') : t('disabledTag') },
    ...entry.entryIds.length > 0
      ? [{ label: t('detailsEntries'), value: entry.entryIds.join('\n'), mono: true }]
      : [],
    ...entry.fiberPhase !== null
      ? [{ label: t('detailsPhase'), value: entry.fiberPhase, mono: true }]
      : [],
  ]
  const suggestions = props.knownTags.filter(tag => (
    !tags.some(current => current.toLocaleLowerCase() === tag.toLocaleLowerCase())
  ))
  return (
    <DetailsDialog
      t={t}
      title={entry.packageName}
      rows={rows}
      onClose={props.onClose}
      actions={(
        <>
          <button
            type="button"
            className={css.button}
            disabled={props.busy}
            onClick={() => {
              const nextTags = mergeTags(tags, tagDraft)
              void props.onSaveNote(note, nextTags).then((ok) => {
                if (!ok) return
                setTags(nextTags)
                setTagDraft('')
                setDirty(false)
              })
            }}
          >
            {props.busy ? t('savingNote') : t('saveNote')}
          </button>
          {entry.canToggle && entry.entryIds[0] !== undefined ? (
            <button
              type="button"
              className={css.button}
              disabled={props.busy}
              onClick={() => {
                const entryId = entry.entryIds[0]
                if (entryId === undefined) return
                props.onToggle(entryId)
              }}
            >
              {entry.enabled ? t('disable') : t('enable')}
            </button>
          ) : null}
          {entry.canUninstall ? (
            <button
              type="button"
              className={css.button}
              disabled={props.busy}
              onClick={props.onUninstall}
            >
              {props.busy ? t('uninstalling') : t('uninstall')}
            </button>
          ) : null}
        </>
      )}
    >
      <label className={css.field}>
        <span>{t('noteLabel')}</span>
        <textarea
          className={css.noteInput}
          value={note}
          placeholder={t('notePlaceholder')}
          onChange={(event) => {
            setNote(event.currentTarget.value)
            setDirty(true)
          }}
        />
      </label>
      <div className={css.field}>
        <span>{t('tagsLabel')}</span>
        <div className={css.tagEditor}>
          {tags.map(tag => (
            <span className={css.noteTag} data-editable="true" key={tag}>
              {tag}
              <button
                type="button"
                className={css.tagRemove}
                aria-label={t('tagsRemove', { tag })}
                onClick={() => {
                  setTags(current => current.filter(item => item.toLocaleLowerCase() !== tag.toLocaleLowerCase()))
                  setDirty(true)
                }}
              >
                <IconCloseOutlineMedium size={10} />
              </button>
            </span>
          ))}
          <input
            className={css.tagInput}
            value={tagDraft}
            placeholder={tags.length === 0 ? t('tagsPlaceholder') : t('tagsAdd')}
            aria-label={t('tagsAdd')}
            onChange={(event) => { setTagDraft(event.currentTarget.value) }}
            onBlur={commitDraft}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
                event.preventDefault()
                commitDraft()
                return
              }
              if (event.key === 'Backspace' && tagDraft.length === 0 && tags.length > 0) {
                setTags(current => current.slice(0, -1))
                setDirty(true)
              }
            }}
          />
        </div>
        {suggestions.length > 0 ? (
          <div className={css.tagSuggest} role="group" aria-label={t('tagsSuggest')}>
            {suggestions.map(tag => (
              <button
                key={tag}
                type="button"
                className={css.filter}
                onClick={() => {
                  setTags(current => mergeTags(current, tag))
                  setDirty(true)
                }}
              >
                {tag}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </DetailsDialog>
  )
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Plugin marketplace copy. */
    'settings.pluginMarketplace': MarketplaceLocaleKey
  }
}
