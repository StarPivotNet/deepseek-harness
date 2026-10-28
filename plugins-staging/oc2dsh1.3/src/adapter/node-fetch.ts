/**
 * Official sidecar talks to Zen via `globalThis.fetch` (Node undici).
 * Chromium fetch and `https.request` both fail the free-lane TLS check.
 */
export function nodeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(input, init)
}
