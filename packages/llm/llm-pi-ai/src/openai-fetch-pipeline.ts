/**
 * Process-wide fetch pipeline wrapping `globalThis.fetch`. pi-ai constructs
 * the OpenAI SDK client without a `fetch` hook, so the only injection point
 * for request rewrites and response repairs is `globalThis.fetch`.
 *
 * Installation is idempotent and reference-counted: every active lease shares
 * ONE wrapper, and the last disposer restores the previous `fetch`. Because a
 * second lease reuses the installed wrapper instead of stacking another one,
 * two concurrent streams can never race each other's restore.
 *
 * @module dsh-llm-pi-ai/openai-fetch-pipeline
 */

import { repairSseJsonResponse } from './sse-json-repair.ts'
import { parseRequestVideoMarker, readEmbeddedVideoMarker, VIDEO_REQUEST_MARKER_PREFIX } from './context.ts'

type FetchFn = typeof globalThis.fetch

/**
 * One active pipeline stage. `onRequest` runs before upstream and may return
 * a rewritten `init`; `onResponse` runs after upstream and may return a
 * repaired response. Both hooks are optional and independent.
 */
export interface FetchPipelineLease {
  /** Inspect or rewrite the outgoing request init; the return value replaces it. */
  onRequest?: (init: RequestInit | undefined, url: string) => RequestInit | undefined
  /** Inspect or repair the upstream response; the return value replaces it. */
  onResponse?: (response: Response) => Response | Promise<Response>
}

let installed: FetchFn | undefined
let previous: FetchFn | undefined
let leases: readonly FetchPipelineLease[] = []

/** The request URL as a string, whichever `fetch` input form carried it. */
function urlOf(input: Parameters<FetchFn>[0]): string {
  return input instanceof Request ? input.url : String(input)
}

/**
 * Install the process-wide fetch pipeline and hold one lease on it. Leases
 * wrap in acquisition order and unwrap the same way; the wrapper itself is
 * installed once and removed when the last lease releases.
 * @param lease - the request/response hooks this lease contributes.
 * @returns a disposer that drops this lease; the last lease restores the previous fetch.
 */
export function acquireFetchPipeline(lease: FetchPipelineLease): () => void {
  if (installed === undefined) {
    previous = globalThis.fetch
    const upstream = previous.bind(globalThis)
    const wrapped: FetchFn = async (input, init) => {
      let effective = init
      for (const active of leases) {
        if (active.onRequest !== undefined) effective = active.onRequest(effective, urlOf(input))
      }
      const response = await upstream(input, effective)
      let result = response
      for (const active of leases) {
        if (active.onResponse !== undefined) result = await active.onResponse(result)
      }
      return result
    }
    installed = wrapped
    globalThis.fetch = wrapped
  }
  leases = [...leases, lease]
  let released = false
  return () => {
    if (released) return
    released = true
    leases = leases.filter(active => active !== lease)
    if (leases.length > 0 || installed === undefined) return
    // Restore only when this module's wrapper is still the installed one: a
    // wrapper another module layered on top of ours must survive our exit.
    if (globalThis.fetch === installed && previous !== undefined) {
      globalThis.fetch = previous
    }
    installed = undefined
    previous = undefined
  }
}

/**
 * Install the process-wide SSE JSON repair stage around `globalThis.fetch`.
 * Compatibility wrapper: the repair is now one {@link FetchPipelineLease}
 * `onResponse` stage of the shared pipeline.
 * @returns a disposer that drops this lease; the last lease restores the previous fetch.
 */
export function acquireOpenAiSseFetchRepair(): () => void {
  return acquireFetchPipeline({ onResponse: repairSseJsonResponse })
}

/** One zai `video_url` content item, the wire form a marker rewrites into. */
interface VideoUrlItem {
  type: 'video_url'
  video_url: { url: string }
}

/** Stable text left where a marker named a video the request cannot carry. */
const UNAVAILABLE_VIDEO_TEXT = '[video attachment unavailable]'

/** Stand-in for a string content whose every character was a removed marker. */
const EMPTY_TOOL_VIDEO_TEXT = '(video attached below)'

/** Lead text of the synthetic user message carrying tool-result videos, mirroring pi-ai's image message. */
const TOOL_VIDEO_LEAD_TEXT = 'Attached video(s) from tool result:'

/** Build the wire item one known marker rewrites into. */
function videoUrlItem(url: string): VideoUrlItem {
  return { type: 'video_url', video_url: { url } }
}

/**
 * Replace marker text items inside one wire content array. An item whose text
 * is exactly one marker becomes the video's `video_url` item, or the
 * unavailable placeholder when the id resolves to nothing. Other items are
 * left untouched.
 * @param items - wire content items of one message.
 * @param videos - base64 payload by attachment id.
 */
function rewriteMarkerItems(items: unknown[], videos: ReadonlyMap<string, string>): void {
  for (const [index, item] of items.entries()) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as { type?: unknown; text?: unknown }
    if (record.type !== 'text' || typeof record.text !== 'string') continue
    const attachmentId = parseRequestVideoMarker(record.text)
    if (attachmentId === undefined) continue
    const url = videos.get(attachmentId)
    items[index] = url === undefined
      ? { type: 'text', text: UNAVAILABLE_VIDEO_TEXT }
      : videoUrlItem(url)
  }
}

/**
 * Rewrite one string content carrying embedded markers. Known markers are
 * removed from the text and their `video_url` items collected; unknown
 * markers degrade to the unavailable placeholder in place. A marker prefix
 * with no closing bracket or no id is not a marker and stays literal.
 * @param text - wire string content.
 * @param videos - base64 payload by attachment id.
 * @param collected - receives the wire items of the videos removed from this text.
 * @returns the rewritten text.
 */
function stripMarkerString(
  text: string,
  videos: ReadonlyMap<string, string>,
  collected: VideoUrlItem[],
): string {
  let result = ''
  let rest = text
  while (true) {
    const start = rest.indexOf(VIDEO_REQUEST_MARKER_PREFIX)
    if (start === -1) return result + rest
    const marker = readEmbeddedVideoMarker(rest.slice(start))
    if (marker === undefined) {
      result += rest.slice(0, start + VIDEO_REQUEST_MARKER_PREFIX.length)
      rest = rest.slice(start + VIDEO_REQUEST_MARKER_PREFIX.length)
      continue
    }
    const url = videos.get(marker.attachmentId)
    result += rest.slice(0, start)
    if (url === undefined) {
      result += UNAVAILABLE_VIDEO_TEXT
    } else {
      collected.push(videoUrlItem(url))
    }
    rest = rest.slice(start + marker.length)
  }
}

/**
 * Rewrite one wire message in place. Array content has marker items replaced
 * directly; string content has embedded markers removed and their videos
 * collected for a following synthetic user message, because a `video_url`
 * item cannot ride a string content — the same move pi-ai itself makes for
 * tool-result images.
 * @param message - one parsed wire message.
 * @param videos - base64 payload by attachment id.
 * @param collected - receives wire items of videos this message gave up.
 * @returns whether this message added videos to `collected`.
 */
function rewriteMessage(
  message: unknown,
  videos: ReadonlyMap<string, string>,
  collected: VideoUrlItem[],
): boolean {
  if (typeof message !== 'object' || message === null) return false
  const record = message as { content?: unknown }
  if (Array.isArray(record.content)) {
    rewriteMarkerItems(record.content, videos)
    return false
  }
  if (typeof record.content === 'string' && record.content.includes(VIDEO_REQUEST_MARKER_PREFIX)) {
    const before = collected.length
    const stripped = stripMarkerString(record.content, videos, collected)
    // A tool result that was nothing but markers would hand the provider an
    // empty string content, which several gateways refuse; the videos ride the
    // synthetic message, so the string says where they went.
    record.content = stripped.length > 0 ? stripped : EMPTY_TOOL_VIDEO_TEXT
    return collected.length > before
  }
  return false
}

/**
 * Rewrite every video request marker in one OpenAI chat-completions request
 * body into zai `video_url` content items, re-serializing the body. Videos
 * removed from string contents (tool results) ride a synthetic user message
 * inserted after the last message of their run.
 * @param body - the serialized request body, known to contain a marker prefix.
 * @param videos - base64 payload by attachment id.
 * @returns the rewritten serialized body.
 * @throws Error when the body does not parse as a JSON object with a messages array.
 */
export function rewriteOpenAiVideoBody(body: string, videos: ReadonlyMap<string, string>): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch (error: unknown) {
    throw new Error(`llm-pi-ai: video marker rewrite found an unparseable request body: ${String(error)}`, {
      cause: error,
    })
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { messages?: unknown }).messages)) {
    throw new Error('llm-pi-ai: video marker rewrite found no messages array in the request body')
  }
  const messages = (parsed as { messages: unknown[] }).messages
  const rewritten: unknown[] = []
  let collected: VideoUrlItem[] = []
  for (const message of messages) {
    const contributed = rewriteMessage(message, videos, collected)
    // The synthetic message lands after the whole run of messages that gave
    // up videos, so a provider that requires tool messages to follow their
    // assistant call directly never sees a user message inside the run.
    if (!contributed && collected.length > 0) {
      rewritten.push({
        role: 'user',
        content: [{ type: 'text', text: TOOL_VIDEO_LEAD_TEXT }, ...collected],
      })
      collected = []
    }
    rewritten.push(message)
  }
  if (collected.length > 0) {
    rewritten.push({
      role: 'user',
      content: [{ type: 'text', text: TOOL_VIDEO_LEAD_TEXT }, ...collected],
    })
  }
  ;(parsed as { messages: unknown[] }).messages = rewritten
  return JSON.stringify(parsed)
}

/**
 * Pipeline `onRequest` stage that injects the zai `video_url` wire form for
 * video request markers. Skips — returning the init unchanged — unless the
 * request is a POST to a chat-completions URL whose string body contains a
 * marker prefix, so marker-free traffic pays one substring scan.
 * @param init - outgoing request init.
 * @param url - request URL.
 * @param videos - base64 payload by attachment id.
 * @returns the original init when nothing applies, otherwise a copy with the rewritten body.
 */
export function rewriteOpenAiVideoUrls(
  init: RequestInit | undefined,
  url: string,
  videos: ReadonlyMap<string, string>,
): RequestInit | undefined {
  if (init?.method?.toUpperCase() !== 'POST') return init
  if (!url.endsWith('/chat/completions')) return init
  if (typeof init.body !== 'string' || !init.body.includes(VIDEO_REQUEST_MARKER_PREFIX)) return init
  return { ...init, body: rewriteOpenAiVideoBody(init.body, videos) }
}
