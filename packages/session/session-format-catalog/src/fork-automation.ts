/** Import headers and event vocabulary emitted by the fork's historical V0–V3 writers. */
import { createSessionFormatCatalog, isSessionFormatJsonObject, SessionFormatEventCollector, SessionFormatUnsupportedMigrationError } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatCatalog, SessionFormatCatalogOptions, SessionFormatJsonValue } from '@deepseek-ai/dsh-session-format'
import { ReleasedV3ToV4Stage, RELEASED_V3_EVENT_TYPES } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { historicalSessionFormatCatalogOptions } from './historical.ts'
import { restoreReleasedV3Artifact } from '@deepseek-ai/dsh-session-format-v2-to-v3'

const forkEventTypes = new Set([...RELEASED_V3_EVENT_TYPES, 'automation/start', 'workspace/home'])
/** Fork V0–V3 child evidence with the observed extension event vocabulary. */
export const forkHistoricalSessionFormatCatalog = createSessionFormatCatalog({
  ...historicalSessionFormatCatalogOptions,
  restoreCurrent: artifact => restoreReleasedV3Artifact(artifact, forkEventTypes),
  restoreTransformedCurrent: artifact => restoreReleasedV3Artifact(artifact, forkEventTypes),
})

const forkMigrationInputCatalog = createSessionFormatCatalog({
  ...historicalSessionFormatCatalogOptions,
  restoreCurrent: artifact => artifact,
  restoreTransformedCurrent: artifact => artifact,
})

function historicalForkHeader(value: unknown) {
  return isSessionFormatJsonObject(value)
    && Number.isInteger(value['version']) && (value['version'] as number) >= 0 && (value['version'] as number) <= 3
}

function structuralHeader(value: unknown) {
  if (!isSessionFormatJsonObject(value)) throw new Error('Automation import requires a header object')
  if (value['origin'] !== 'automation') return value
  const { origin: _origin, ...header } = value
  return header
}

/**
 * Preserve fork Automation attribution outside the historical upstream header validators.
 * The structural header and event bodies retain all historical validation. Imported
 * events go directly from V3 vocabulary to V5; no V4 artifact is created or published.
 * @param catalog - normal adjacent catalog for upstream and current formats.
 * @param options - installed V5 validation callbacks.
 * @param children - complete historical child evidence; omitted for header-only catalogs.
 * @returns catalog with a dedicated historical fork import route.
 */
export function withForkAutomationImport(
  catalog: SessionFormatCatalog,
  options: SessionFormatCatalogOptions,
  children?: readonly SessionFormatJsonValue[],
): SessionFormatCatalog {
  return {
    ...catalog,
    readHeader(value) {
      if (!historicalForkHeader(value)) return catalog.readHeader(value)
      const result = forkHistoricalSessionFormatCatalog.readHeader(structuralHeader(value))
      if (result.status === 'malformed' || result.status === 'unsupported') return { ...result, targetVersion: options.currentVersion }
      const header = options.restoreCurrentHeader({ ...result.header, version: 5, ...(isSessionFormatJsonObject(value) && value['origin'] === 'automation' ? { origin: 'automation' } : {}) })
      return { status: 'migration-required', storedVersion: result.storedVersion, targetVersion: 5, header }
    },
    createRestore(value, restoreOptions) {
      if (!historicalForkHeader(value)) return catalog.createRestore(value, restoreOptions)
      if (children === undefined) throw new SessionFormatUnsupportedMigrationError('Fork import requires explicit historical child facts, including an empty array for a parent without children')
      const historical = forkMigrationInputCatalog.createRestore(structuralHeader(value), restoreOptions)
      const header = options.restoreCurrentHeader({ ...historical.header, version: 5, ...(isSessionFormatJsonObject(value) && value['origin'] === 'automation' ? { origin: 'automation' } : {}) })
      return {
        header,
        decodeRow(row) { historical.decodeRow(row) },
        finish() {
          const source = historical.finish()
          const stage = new ReleasedV3ToV4Stage({ sourceHeader: source.header, targetHeader: header,
            sourceInheritedEventCount: source.inheritedEventCount, sourceKind: 'transformed' }, children, forkEventTypes)
          const output = new SessionFormatEventCollector()
          for (const event of source.events) {
            if (event.type === 'session-log-deepseek/delivery-accepted' && isSessionFormatJsonObject(event.data)
              && event.data['sessionFormatVersion'] === 5) throw new SessionFormatUnsupportedMigrationError('historical Automation delivery marker claims target format v5')
            stage.transformEvent(event, output)
          }
          const artifact = { header, events: output.values, inheritedEventCount: stage.finish(output) }
          try {
            return restoreOptions.validation === 'current' ? options.restoreCurrent(artifact) : options.restoreTransformedCurrent(artifact)
          } catch (error: unknown) {
            if (restoreOptions.validation === 'current' || error instanceof SessionFormatUnsupportedMigrationError) throw error
            throw new SessionFormatUnsupportedMigrationError(`Fork Session migration refuses the transformed artifact: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
          }
        },
      }
    },
  }
}
