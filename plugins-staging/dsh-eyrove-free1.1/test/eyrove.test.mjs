import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_SIZE, SIZES, createEyroveClient, resolveSize } from '../lib/eyrove.js'

const KEY = '00000000-0000-4000-8000-000000000001'

function jsonResponse(body, { status = 200, cookie = '' } = {}) {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (cookie) headers.append('set-cookie', cookie)
  return new Response(JSON.stringify(body), { status, headers })
}

test('accepts only the nine published pixel sizes', () => {
  for (const size of SIZES) assert.equal(resolveSize(size), size)
  assert.equal(resolveSize(), DEFAULT_SIZE)
  assert.equal(SIZES.length, 9)
  assert.throws(() => resolveSize('999x999'), /unsupported size/)
  assert.throws(() => resolveSize('16:9'), /unsupported size/)
})

test('opens a visitor session, submits the form body, and downloads the finished image', async () => {
  const calls = []
  const prompt = 'a red apple on a white table'
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body, cookie: init.headers?.Cookie, accept: init.headers?.Accept })
    if (String(url).endsWith('/session')) {
      return jsonResponse({ ready: true }, { cookie: 'eyrove_free_visitor=visitor; Path=/; HttpOnly' })
    }
    if (String(url).endsWith('/api/free-generations')) {
      return jsonResponse({
        generation: { id: 'job-1', status: 'queued', prompt, size: '1024x1024' },
        receipt: 'r1',
      })
    }
    if (String(url).endsWith('/job-1')) {
      return jsonResponse({
        generation: { id: 'job-1', status: 'succeeded', prompt, size: '1024x1024' },
        receipt: 'r1',
      })
    }
    if (String(url).endsWith('/result')) {
      return new Response(Uint8Array.from([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } })
    }
    if (String(url).endsWith('/ack')) return jsonResponse({})
    throw new Error(`unexpected ${url}`)
  }
  const client = createEyroveClient({
    fetchImpl,
    randomUUID: () => KEY,
    sleepImpl: async () => {},
  })
  const image = await client.generate({ prompt, size: '1024x1024', templateId: 'editorial-desk' })
  const session = JSON.parse(calls[0].body)
  assert.equal(session.locale, 'zh-cn')
  assert.equal(session.templateId, 'editorial-desk')
  const submitted = JSON.parse(calls[1].body)
  assert.equal(submitted.prompt, prompt)
  assert.equal(submitted.size, '1024x1024')
  assert.equal(submitted.locale, 'zh-cn')
  assert.equal(submitted.templateId, 'editorial-desk')
  assert.equal(submitted.idempotencyKey, KEY)
  assert.equal(calls[1].cookie, 'eyrove_free_visitor=visitor')
  assert.equal(image.mediaType, 'image/png')
  assert.equal(image.bytes.length, 3)
  assert.equal(image.size, '1024x1024')
  assert.equal(image.id, 'job-1')
  assert.equal(calls.at(-1).url.endsWith('/ack'), true)
})

test('surfaces an admission code and a failed job without downloading an image', async () => {
  const rejected = createEyroveClient({
    randomUUID: () => KEY,
    fetchImpl: async (url) => {
      if (String(url).endsWith('/session')) {
        return jsonResponse({ ready: true }, { cookie: 'eyrove_free_visitor=visitor; Path=/' })
      }
      return jsonResponse({ code: 'CONTENT_REJECTED' }, { status: 400 })
    },
  })
  await assert.rejects(() => rejected.generate({ prompt: 'apple', size: '720x1280' }), /CONTENT_REJECTED/)

  const failed = createEyroveClient({
    randomUUID: () => KEY,
    sleepImpl: async () => {},
    fetchImpl: async (url) => {
      if (String(url).endsWith('/session')) {
        return jsonResponse({ ready: true }, { cookie: 'eyrove_free_visitor=visitor; Path=/' })
      }
      if (String(url).endsWith('/api/free-generations')) {
        return jsonResponse({ generation: { id: 'job-2', status: 'queued' } })
      }
      if (String(url).endsWith('/result')) throw new Error('should not download')
      return jsonResponse({ generation: { id: 'job-2', status: 'failed', errorCode: 'GENERATION_FAILED' } })
    },
  })
  await assert.rejects(() => failed.generate({ prompt: 'apple', size: '720x1280' }), /GENERATION_FAILED/)
})
