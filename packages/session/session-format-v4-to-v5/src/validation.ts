/** Native V5 metadata and generation-owned relationship validation. */

import { isAbsolute } from 'node:path'
import { SessionFormatError, SessionFormatUnsupportedMigrationError, isSessionFormatJsonObject, sessionFormatCount } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatArtifact, SessionFormatEvent, SessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'
import { assertV4DeveloperData } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { assertLifecycleRelationshipsWithAbandonedSteps } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { mapEventMessages } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { catalogFact } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { assertV4RetiredSyntax } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { assertV4SystemMessageFields } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { assertV4ForkResult } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { assertV4ToolResultMessage } from '@deepseek-ai/dsh-session-format-v3-to-v4'

/**
 * Validate the exact native V5 logical header.
 * @param header - decoded or otherwise untrusted V5 Session header candidate.
 */
export function assertReleasedV5Header(header: unknown): void {
  if (!isSessionFormatJsonObject(header) || header['version'] !== 5) throw new SessionFormatError('expected format v5 header')
  const required = ['version', 'id', 'createdAt', 'isSeeded', 'delegationDepth']
  const allowed = new Set([...required, 'cwd', 'parentSession', 'origin', 'agentPreset'])
  const missing = required.find(key => !Object.hasOwn(header, key))
  const unexpected = Object.keys(header).find(key => !allowed.has(key))
  if (missing !== undefined) throw new SessionFormatError(`format v5 header lacks required field ${missing}`)
  if (unexpected !== undefined) throw new SessionFormatError(`format v5 header has unexpected field ${unexpected}`)
  if (typeof header.id !== 'string') throw new SessionFormatError('format v5 header id must be a string')
  sessionFormatCount(header.createdAt, 'format v5 header createdAt')
  sessionFormatCount(header.delegationDepth, 'format v5 header delegationDepth')
  if (typeof header.isSeeded !== 'boolean') throw new SessionFormatError('format v5 header isSeeded must be boolean')
  if (header.cwd !== undefined && (typeof header.cwd !== 'string' || !isAbsolute(header.cwd))) {
    throw new SessionFormatError('format v5 header cwd must be absolute')
  }
  for (const key of ['parentSession', 'agentPreset']) {
    if (header[key] !== undefined && typeof header[key] !== 'string') {
      throw new SessionFormatError(`format v5 header ${key} must be a string`)
    }
  }
  if (header.origin !== undefined && header.origin !== 'subagent' && header.origin !== 'automation') {
    throw new SessionFormatError('format v5 header origin must be "subagent" or "automation"')
  }
}

/**
 * Validate V5 inheritance, vocabulary, native message admission, and
 * lifecycle, compaction, tool, retry, title, command, catalog, and delivery ownership.
 * Installed Session restoration owns common event envelopes and message acceptance.
 * @param artifact - complete detached V5 artifact.
 * @param knownEventTypes - event types understood by the installed Session package.
 * @returns the same validated artifact and event objects.
 */
export function restoreReleasedV5Artifact(artifact: SessionFormatArtifact, knownEventTypes: ReadonlySet<string>): SessionFormatArtifact {
  assertReleasedV5Header(artifact.header)
  const cut = sessionFormatCount(artifact.inheritedEventCount, 'format v5 inherited event count')
  if (cut > artifact.events.length) throw new SessionFormatError('format v5 inherited event count exceeds its events')
  if (!artifact.header.isSeeded && cut !== 0) throw new SessionFormatError('unseeded format v5 Session has inherited events')
  let lastInheritedMarker: number | undefined
  for (const [index, event] of artifact.events.entries()) {
    if (!knownEventTypes.has(event.type) && event['ignorable'] !== true) {
      throw new SessionFormatUnsupportedMigrationError(
        `format v5 contains unknown event type ${JSON.stringify(event.type)} at seq ${index}`,
      )
    }
    if (event.seq !== index) throw new SessionFormatError(`format v5 event ${index} is not dense`)
    if (!knownEventTypes.has(event.type)) continue
    assertV4RetiredSyntax(event)
    assertV4SystemMessageFields(event)
    assertV4ToolResultMessage(event)
    assertV4ForkResult(event)
    if (event.type === 'session/end-seed' && isSessionFormatJsonObject(event.data)
      && event.data['inherited'] === true) lastInheritedMarker = index
  }
  if (artifact.header.isSeeded && lastInheritedMarker !== cut) {
    throw new SessionFormatError('format v5 seeded header disagrees with its last inherited end-seed marker')
  }
  if (!artifact.header.isSeeded && lastInheritedMarker !== undefined) {
    throw new SessionFormatError('format v5 unseeded Session contains an inherited end-seed marker')
  }
  assertReleasedV5Relationships(artifact, knownEventTypes)
  return artifact
}

/**
 * Validate delivery generation and active-generation coordinates before evaluating ownership.
 * @param event - decoded event whose delivery payload may be inspected.
 * @param currentVersion - generation whose watermark coordinates are active.
 * @returns the active delivery's nonempty Session id, or undefined for other events and generations.
 */
export function validateDeliveryAccepted(event: SessionFormatEvent, currentVersion: 4 | 5): string | undefined {
  if (event.type !== 'session-log-deepseek/delivery-accepted') return undefined
  const data = event.data
  if (!isSessionFormatJsonObject(data)) throw new SessionFormatError('delivery-accepted data must be an object')
  const version = sessionFormatCount(data['sessionFormatVersion'] === undefined ? 0 : data['sessionFormatVersion'], 'delivery sessionFormatVersion')
  if (version !== currentVersion) return undefined
  const throughSeq = sessionFormatCount(data['throughSeq'], 'delivery throughSeq')
  if (throughSeq >= event.seq) throw new SessionFormatError('delivery throughSeq must precede its marker')
  const id = data['sessionId']
  if (typeof id !== 'string' || id.length === 0) throw new SessionFormatError('delivery requires a nonempty Session id')
  return id
}

/**
 * Validate native developer fields, message sources, lifecycle, catalog, and delivery
 * relationships without changing event vocabulary or tail recovery.
 * The owning admission stage rejects unknown required events;
 * unknown ignorable records retain their uninterpreted payloads.
 * @param artifact - decoded artifact with its final inherited cut.
 * @param knownEventTypes - installed event types whose payloads this reader interprets.
 */
export function assertReleasedV5Relationships(artifact: SessionFormatArtifact, knownEventTypes: ReadonlySet<string>): void {
  const ids = new Set<string>()
  for (const event of artifact.events) {
    if (!knownEventTypes.has(event.type)) continue
    assertV5DeveloperData(event)
    assertV5MessageSources(event)
    const deliveryId = validateDeliveryAccepted(event, 5)
    if (deliveryId !== undefined
      && !(artifact.header.parentSession !== undefined && event.seq < artifact.inheritedEventCount)
      && deliveryId !== artifact.header.id) {
      throw new SessionFormatError('current-generation delivery marker names the wrong Session')
    }
    if (event.type === 'subagent/catalog' && event.seq >= artifact.inheritedEventCount) {
      const fact = catalogFact(event.data)
      const id = fact['childId'] as string
      if (ids.has(id)) throw new SessionFormatError(`duplicate catalog child ${id}`)
      ids.add(id)
    }
  }
  assertLifecycleRelationshipsWithAbandonedSteps(artifact, knownEventTypes, failedStepEnds(artifact, knownEventTypes))
}

/**
 * Validate current producer attribution, including fork plugin and Automation sources.
 * @param event - event carrying durable messages.
 */
export function assertV5MessageSources(event: SessionFormatEvent): void {
  mapEventMessages(event, (message) => {
    const source = message['source']
    if (!isSessionFormatJsonObject(source) || typeof source['kind'] !== 'string' || source['kind'].length === 0) {
      throw new SessionFormatError('format v5 message requires a producer source kind')
    }
    const field = source['kind'] === 'plugin' ? 'plugin' : source['kind'] === 'automation' ? 'ruleId' : undefined
    if (field !== undefined && (typeof source[field] !== 'string' || source[field].length === 0)) {
      throw new SessionFormatError(`format v5 ${source['kind']} source requires ${field}`)
    }
    return message
  })
}

/**
 * Validate native V5 event fields before recoverable-tail classification.
 * @param row - parsed physical row.
 * @param knownEventTypes - installed vocabulary for ignorable developer events.
 */
export function assertV5RowAdmission(row: unknown, knownEventTypes?: ReadonlySet<string>): void {
  if (isSessionFormatJsonObject(row)) {
    if (row['type'] === 'developer/message' && row['ignorable'] === true
      && knownEventTypes?.has('developer/message') !== true) return
    assertV5DeveloperData(row)
  }
  assertV4RetiredSyntax(row)
  assertV4SystemMessageFields(row)
  if (!isSessionFormatJsonObject(row) || row['type'] !== 'tool/result') return
  const event = row as SessionFormatJsonObject & SessionFormatEvent
  assertV4ToolResultMessage(event)
  assertV4ForkResult(event)
}

/** V4 developer field validation uses a private producer-kind view; persisted attribution is unchanged. */
function assertV5DeveloperData(row: unknown): void {
  if (!isSessionFormatJsonObject(row)) return
  const event = row as SessionFormatJsonObject & SessionFormatEvent
  const data = event.data
  if (event.type !== 'developer/message' || !isSessionFormatJsonObject(data)
    || !isSessionFormatJsonObject(data['message']) || !isSessionFormatJsonObject(data['message']['source'])
    || data['message']['source']['kind'] !== 'plugin') {
    assertV4DeveloperData(event)
    return
  }
  assertV5MessageSources(event)
  const message = data['message']
  const source = data['message']['source']
  assertV4DeveloperData({ ...event, data: { ...data, message: { ...message,
    source: { ...source, kind: `plugin:${source['plugin']}` },
  } } })
}

/** A step immediately closed by an error-ended turn retains unknown tool outcomes. */
function failedStepEnds(artifact: SessionFormatArtifact, knownEventTypes: ReadonlySet<string>): ReadonlySet<number> {
  const ends = new Set<number>()
  if (!knownEventTypes.has('step/end') || !knownEventTypes.has('turn/end')) return ends
  for (const [index, event] of artifact.events.entries()) {
    if (event.type !== 'step/end' || !isSessionFormatJsonObject(event.data)) continue
    const next = artifact.events[index + 1]
    if (next?.type !== 'turn/end' || !isSessionFormatJsonObject(next.data)
      || next.data['turn'] !== event.data['turn']) continue
    const reason = next.data['reason']
    if (isSessionFormatJsonObject(reason) && reason['kind'] === 'error') ends.add(event.seq)
  }
  return ends
}
