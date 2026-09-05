/** General Settings row for product-update checks. */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ProductCheckResult } from '../update-settings.ts'
import css from './UpdateRow.module.css'

/** Installer phase shown on the Settings row and overlay toast. */
export type ProductUpdateInstallPhase = 'idle' | 'downloading' | 'verifying' | 'applying' | 'ready' | 'error'

/** Client-side installer presentation. */
export interface ProductUpdateInstallStatus {
  phase: ProductUpdateInstallPhase
  received: number
  total: number
  error?: string
}

/** Registration-side preference face. */
export interface UpdateRowInjected {
  hooks: {
    /** Latest check result and in-flight flag. */
    status: SnapshotStore<ProductUpdateUiStatus>
  }
  /** Ask the Host to poll GitHub now. */
  checkNow: () => void
  /** Persist dismissedTag for the current latest release. */
  dismiss: () => void
  /** Open the latest release URL. */
  openRelease: () => void
  /** Whether this page is a packaged desktop window that can install. */
  canInstall: () => boolean
  /** Ask Electron to download and stage the latest artifact. */
  installNow: () => void
  /** Abort an in-flight download. */
  cancelInstall: () => void
  /** Quit and replace the running app with the staged archive. */
  relaunchToUpdate: () => void
}

/** Client-side check presentation. */
export interface ProductUpdateUiStatus {
  checking: boolean
  error: boolean
  result: ProductCheckResult | undefined
  install?: ProductUpdateInstallStatus
}

/** Full Settings-row props. */
export type UpdateRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.productUpdate'>
  & InjectFace<UpdateRowInjected>

/**
 * Render the product-update preference row.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function UpdateRow({
  useStatus, checkNow, dismiss, openRelease, canInstall, installNow, cancelInstall, relaunchToUpdate, t,
}: UpdateRowProps) {
  const status = useStatus(value => value)
  const result = status.result
  const install = status.install ?? { phase: 'idle' as const, received: 0, total: 0 }
  const lastChecked = result === undefined
    ? t('neverChecked')
    : t('lastChecked', { time: formatCheckedAt(result.checkedAt) })
  const version = result?.currentVersion ?? ''
  const available = result?.available === true && result.latest !== undefined
  const dismissed = result !== undefined
    && !result.available
    && result.latest !== undefined
  const showInstall = available && result.latest?.artifact !== undefined && canInstall()
  const installing = install.phase === 'downloading' || install.phase === 'verifying' || install.phase === 'applying'
  const percent = install.total > 0 ? Math.min(100, Math.floor((install.received / install.total) * 100)) : 0
  const statusText = status.checking ? t('checking')
    : install.phase === 'error' ? t('installFailed')
      : installing && install.phase === 'downloading' ? t('installProgress', { percent: String(percent) })
        : installing ? t('installing')
          : install.phase === 'ready' ? t('installReady')
            : status.error ? t('checkFailed')
              : available && result.latest !== undefined ? t('available', { version: result.latest.version })
                : dismissed ? t('dismissed')
                  : result !== undefined ? t('upToDate')
                    : undefined

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('title')}</div>
        <div className={css.desc}>{t('description')}</div>
        {version !== '' && (
          <div className={css.meta}>{t('currentVersion', { version })}</div>
        )}
        <div className={css.meta}>{lastChecked}</div>
        {statusText !== undefined && <div className={css.status}>{statusText}</div>}
        {install.phase === 'downloading' && (
          <div className={css.progress} role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <div className={css.progressFill} style={{ width: `${String(percent)}%` }} />
          </div>
        )}
      </div>
      <div className={css.controls}>
        <div className={css.actions}>
          <Button
            variant="outline"
            size="sm"
            disabled={status.checking || installing}
            onClick={() => { checkNow() }}
          >
            {t('checkNow')}
          </Button>
          {available && (
            <>
              <Button variant="outline" size="sm" onClick={() => { openRelease() }}>
                {t('openRelease')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => { dismiss() }}>
                {t('dismiss')}
              </Button>
            </>
          )}
          {showInstall && install.phase === 'ready' && (
            <Button variant="primary" size="sm" onClick={() => { relaunchToUpdate() }}>
              {t('restart')}
            </Button>
          )}
          {showInstall && installing && (
            <Button variant="outline" size="sm" onClick={() => { cancelInstall() }}>
              {t('cancelInstall')}
            </Button>
          )}
          {showInstall && !installing && install.phase !== 'ready' && (
            <Button variant="primary" size="sm" onClick={() => { installNow() }}>
              {t('install')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function formatCheckedAt(ms: number): string {
  try {
    return new Date(ms).toLocaleString()
  } catch {
    // RangeError / invalid Date: fall back to the raw epoch.
    return String(ms)
  }
}
