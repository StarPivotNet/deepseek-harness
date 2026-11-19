/** Session-list metadata projection definition registered by `SessionQueryEngine`. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'
import type { SessionListMetadata } from './types.ts'

const sessionListMetadataSchema: z.ZodType<SessionListMetadata> = z.object({
  blank: z.boolean(),
  lastPromptAt: z.number().nullable(),
  interrupted: z.literal(true).optional(),
})

/** Advance blankness, human-prompt recency, and interrupted-tail state without retaining history. */
function applySessionListMetadata(
  state: SessionListMetadata,
  event: SessionEvent,
): SessionListMetadata {
  const blank = state.blank && event.type !== 'turn/start'
  const lastPromptAt = event.type === 'user/message' && event.data.source.kind === 'user'
    ? event.time
    : state.lastPromptAt
  let interrupted = state.interrupted === true
  if (event.type === 'turn/start') interrupted = false
  else if (event.type === 'turn/end' && event.data.reason.kind === 'interrupted') interrupted = true
  const unchanged = blank === state.blank
    && lastPromptAt === state.lastPromptAt
    && interrupted === (state.interrupted === true)
  return unchanged ? state : { blank, lastPromptAt, ...interrupted ? { interrupted: true as const } : {} }
}

/** Blankness and latest human-prompt time folded per Session; persisted at state version 1. */
export const sessionListMetadataDefinition = {
  key: 'sessionListMetadata',
  stateSchema: sessionListMetadataSchema,
  init: () => ({ blank: true, lastPromptAt: null }),
  apply: applySessionListMetadata,
  wire: { viewSchema: sessionListMetadataSchema, view: state => state },
  stateVersion: 1,
} satisfies ProjectionDefinition<'sessionListMetadata', SessionListMetadata>
