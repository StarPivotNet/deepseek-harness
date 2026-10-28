/**
 * Shared cognition ledger path helpers.
 * Layout: `$DSH_HOME/cognitions/<project>/<sessionId>/cognition.md`
 */

export function normalizePath(value) {
  return String(value ?? '').replace(/\\/g, '/')
}

export function sessionIdOf(sessionOrAgent) {
  if (sessionOrAgent == null || typeof sessionOrAgent !== 'object') return ''
  const nested = sessionOrAgent.session
  const nestedId = nested == null ? undefined : nested.id
  if (typeof nestedId === 'string' && nestedId.length > 0) return nestedId
  if (typeof nestedId === 'number') return String(nestedId)
  const id = sessionOrAgent.id
  if (typeof id === 'string' && id.length > 0) return id
  if (typeof id === 'number') return String(id)
  return ''
}

export function cwdOf(initiatorOrAgent, session) {
  if (
    initiatorOrAgent != null &&
    initiatorOrAgent.options != null &&
    typeof initiatorOrAgent.options.cwd === 'string'
  ) {
    return initiatorOrAgent.options.cwd
  }
  const fromSession =
    session ?? (initiatorOrAgent != null ? initiatorOrAgent.session : undefined)
  if (
    fromSession != null &&
    fromSession.header != null &&
    typeof fromSession.header.cwd === 'string'
  ) {
    return fromSession.header.cwd
  }
  return ''
}

function dshHome() {
  const env =
    typeof process === 'object' && process != null ? process.env : undefined
  if (env != null && typeof env.DSH_HOME === 'string' && env.DSH_HOME.length > 0) {
    return env.DSH_HOME
  }
  return ''
}

function sessionFilePathFor(cwd, sessionId, fileName) {
  if (typeof cwd !== 'string' || cwd.length === 0) return undefined
  if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined
  const home = dshHome()
  const base = cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'default'
  const slug = base.replace(/[<>:"|?*\x00-\x1f]/g, '_')
  const safeSession = String(sessionId).replace(/[^a-zA-Z0-9-_]/g, '_')
  const sep = home.includes('/') ? '/' : '\\'
  const trimmed = home.replace(/[\\/]+$/, '')
  return [trimmed, 'cognitions', slug, safeSession, fileName].join(sep)
}

export function ledgerPathFor(cwd, sessionId) {
  return sessionFilePathFor(cwd, sessionId, 'cognition.md')
}

export function notesPathFor(cwd, sessionId) {
  return sessionFilePathFor(cwd, sessionId, 'notes.md')
}

export function isCognitionPath(value) {
  if (typeof value !== 'string' || value.length === 0) return false
  return /cognitions\/[^/]+\/[^/]+\/cognition\.md$/i.test(normalizePath(value))
}

export function isNotesPath(value) {
  if (typeof value !== 'string' || value.length === 0) return false
  return /cognitions\/[^/]+\/[^/]+\/notes\.md$/i.test(normalizePath(value))
}

export function isSessionMemoryPath(value) {
  return isCognitionPath(value) || isNotesPath(value)
}
