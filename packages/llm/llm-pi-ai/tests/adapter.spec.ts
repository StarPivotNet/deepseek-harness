import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { AttachmentId, AttachmentStore, ImageVariantId } from '@deepseek-ai/dsh-attachment'
import type {
  ImageAttachmentLimits,
  ImageAttachmentRef,
  ImageRequestTarget,
  RequestImageAttachment,
  RequestVideoAttachment,
  SaveImageAttachment,
  StoredImageAttachment,
  VideoAttachmentRef,
} from '@deepseek-ai/dsh-attachment'
import LlmRuntime, { createUserMessage, CONTEXT_WINDOW_EXCEEDED_CODE, LlmError, ReasoningEffortId, userAgent } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { DEFAULT_MAX_REQUEST_IMAGE_BYTES, DEFAULT_MAX_REQUEST_VIDEO_BYTES, resolveProfiles } from '../src/config.ts'
import { memoryAuth } from './auth-double.ts'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

afterEach(async () => {
  vi.unstubAllEnvs()
  await closeMockServers()
})

const IMAGE_REF: ImageAttachmentRef = {
  attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
  mediaType: 'image/png',
  bytes: 1,
  width: 1,
  height: 1,
}
const HOST_IMAGE_PATH = '/host/.dsh/attachments/objects/aa/object'
const MODEL_IMAGE_PATH = '/model/.dsh/attachments/objects/aa/object'

class MappedFileSystem extends Service {
  constructor(ctx: Context) {
    super(ctx, 'fs')
  }

  processPathFromHostPath(hostPath: string): string | undefined {
    return hostPath === HOST_IMAGE_PATH ? MODEL_IMAGE_PATH : undefined
  }
}

const VIDEO_REF: VideoAttachmentRef = {
  attachmentId: AttachmentId(`sha256:${'b'.repeat(64)}`),
  mediaType: 'video/mp4',
  bytes: 3,
}

/** The raw request version one stored video resolves to. */
function requestVideo(ref: VideoAttachmentRef, data = 'QUJD'): RequestVideoAttachment {
  return { attachment: ref, data, mediaType: ref.mediaType, bytes: ref.bytes, version: 'raw-v1' }
}

/**
 * An attachment store that only answers request projections. Image
 * persistence members reject and video members keep the base class's
 * fail-loud defaults: these tests never persist, only re-read.
 */
class RequestOnlyAttachmentStore extends AttachmentStore {
  readonly imageLimits: ImageAttachmentLimits = {
    maxImageBytes: 1,
    maxImagesPerMessage: 1,
    maxMessageImageBytes: 1,
    maxImagePixels: 1,
    maxImageDimension: 2000,
    mediaTypes: ['image/png'],
  }

  private readonly videos: ReadonlyMap<string, string>

  constructor(ctx: Context, config?: { videos?: ReadonlyMap<string, string> }) {
    super(ctx)
    this.videos = config?.videos ?? new Map([[String(VIDEO_REF.attachmentId), 'QUJD']])
  }

  private readonly refused = () => Promise.reject(new Error('not used'))

  validateImage(_input: SaveImageAttachment): Promise<void> {
    return this.refused()
  }

  saveImage(_input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    return this.refused()
  }

  readImage(_ref: ImageAttachmentRef): Promise<StoredImageAttachment> {
    return this.refused()
  }

  override readVideoRequest(ref: VideoAttachmentRef): Promise<RequestVideoAttachment> {
    return Promise.resolve(requestVideo(ref, this.videos.get(String(ref.attachmentId)) ?? 'QUJD'))
  }
}

/** Plain-object store answering only `readVideoRequest`, for direct adapter tests. */
function storeWithVideos(videos?: ReadonlyMap<string, string>): AttachmentStore {
  const payload = videos ?? new Map([[String(VIDEO_REF.attachmentId), 'QUJD']])
  return {
    readVideoRequest: (ref: VideoAttachmentRef) =>
      Promise.resolve(requestVideo(ref, payload.get(String(ref.attachmentId)) ?? 'QUJD')),
  } as unknown as AttachmentStore
}

/** Adapter over the real resolver with a request-only attachment store. */
function adapterWithStore(
  providers: Record<string, LlmPiAi.PiAiProviderProfile>,
  videos?: ReadonlyMap<string, string>,
): PiAiAdapter {
  return new PiAiAdapter({
    profiles: () => resolveProfiles(providers),
    resolveApiKey: () => Promise.resolve('test-key'),
    auth: memoryAuth(),
    resolveAttachments: () => storeWithVideos(videos),
  })
}

async function harness(baseURL: string, overrides: Record<string, unknown> = {}): Promise<Context> {
  vi.stubEnv('PI_TEST_KEY', 'test-key')
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmPiAi, {
    providers: { deepseek: { apiKeyEnv: 'PI_TEST_KEY', baseURL, ...overrides } },
  })
  return ctx
}

/** Direct adapter over the real profile resolver, with a fixed key per call. */
function adapterOf(
  providers: Record<string, LlmPiAi.PiAiProviderProfile>,
  apiKey: string | undefined = 'test-key',
): PiAiAdapter {
  return new PiAiAdapter({
    profiles: () => resolveProfiles(providers),
    resolveApiKey: () => Promise.resolve(apiKey),
    auth: memoryAuth(),
  })
}

beforeEach(() => {
  // Configuration carries only the reference; these mounts resolve it from
  // the environment, which is the whole credential plane without a seam.
  vi.stubEnv('PI_TEST_KEY', 'test-key')
})

describe('PiAiAdapter provider routing', () => {
  it('resolves a catalog model dynamically and uses a private endpoint', async () => {
    const server = await mockServer([{ events: textEvents }])
    const ctx = await harness(server.url)
    const result = await assemble(ctx, {
      model: 'deepseek-v4-flash',
      messages: [createUserMessage({
        content: [{ type: 'text', text: 'hi' }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })
    expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(result.finish).toEqual({ kind: 'stop' })
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 1, totalTokens: 4 })
    expect(server.paths).toEqual(['/chat/completions'])
  })

  it('keeps prepared model metadata and dispatch on one profile snapshot', async () => {
    const first = await mockServer([{ events: textEvents }])
    const second = await mockServer([])
    let providers: Record<string, LlmPiAi.PiAiProviderProfile> = {
      deepseek: { apiKeyEnv: 'PI_TEST_KEY', baseURL: first.url },
    }
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['deepseek'], new PiAiAdapter({
      profiles: () => resolveProfiles(providers),
      resolveApiKey: () => Promise.resolve('test-key'),
      auth: memoryAuth(),
    }))

    const prepared = await ctx.llm.prepareCall({ provider: 'deepseek', model: 'deepseek-v4-flash' })
    providers = { deepseek: { apiKeyEnv: 'PI_TEST_KEY', baseURL: second.url } }
    const chunks: unknown[] = []
    for await (const chunk of prepared.stream({ ...prepared.config, messages: [] })) chunks.push(chunk)

    expect(chunks.length).toBeGreaterThan(0)
    expect(first.requests).toHaveLength(1)
    expect(second.requests).toHaveLength(0)
  })

  it('merges profile headers with Harness attribution winning', async () => {
    const server = await mockServer([{ events: textEvents }])
    const ctx = await harness(server.url, {
      headers: { 'x-company': 'private', 'User-Agent': 'wrong' },
    })
    await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(server.headers[0]?.['x-company']).toBe('private')
    expect(server.headers[0]?.['user-agent']).toBe(userAgent())
  })

  it('forwards common stream options and profile reasoning', async () => {
    const server = await mockServer([{ events: textEvents }])
    const ctx = await harness(server.url, {
      reasoning: 'max',
      cacheRetention: 'none',
      transport: 'sse',
      timeoutMs: 5000,
      websocketConnectTimeoutMs: 3000,
      streamIdleTimeoutMs: 10_000,
      thinkingBudgets: { high: 2048 },
    })
    await assemble(ctx, {
      model: 'deepseek-v4-pro',
      messages: [],
      temperature: 0.2,
      maxTokens: 77,
      sessionId: 'session-for-pi' as never,
    })
    expect(server.requests[0]).toMatchObject({
      model: 'deepseek-v4-pro',
      temperature: 0.2,
      max_tokens: 77,
      thinking: { type: 'enabled' },
      reasoning_effort: 'max',
    })
    expect(server.requests[0]).not.toHaveProperty('dsh_session_log')
    expect(server.requests[0]).not.toHaveProperty('dsh_plugin_packages')
  })

  it('uses a dynamic request effort and reports unsupported efforts before network I/O', async () => {
    const server = await mockServer([{ events: textEvents }, { events: textEvents }])
    const ctx = await harness(server.url, { reasoning: 'max' })

    await assemble(ctx, {
      model: 'deepseek-v4-flash',
      reasoningEffort: ReasoningEffortId('high'),
      messages: [],
    })
    expect(server.requests[0]).toMatchObject({ reasoning_effort: 'high' })

    await assemble(ctx, {
      model: 'deepseek-v4-flash',
      reasoningEffort: ReasoningEffortId('off'),
      messages: [],
    })
    expect(server.requests[1]).toMatchObject({ thinking: { type: 'disabled' } })
    expect(server.requests[1]).not.toHaveProperty('reasoning_effort')

    const unsupported = await assemble(ctx, {
      model: 'deepseek-v4-flash',
      reasoningEffort: ReasoningEffortId('xhigh'),
      messages: [],
    })
    expect(unsupported.finish).toMatchObject({
      kind: 'error',
      failure: { code: 'UNSUPPORTED_REASONING_EFFORT' },
    })
    expect(server.requests).toHaveLength(2)
  })

  it('preserves omitted profile options when constructing the adapter directly', async () => {
    const server = await mockServer([{ events: textEvents }])
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['deepseek'], adapterOf({
      deepseek: { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url },
    }))

    const result = await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })

    expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('names a route by its displayName, and by its own key once the profiles drop it', () => {
    const adapter = adapterOf({ 'acme-gateway': {
      displayName: 'Acme Gateway',
      api: 'openai-completions',
      baseURL: 'https://acme.test/v1',
      models: [{ id: 'acme-large' }],
    } })
    expect(adapter.providerInfo('acme-gateway')).toEqual({ id: 'acme-gateway', name: 'Acme Gateway' })

    // The registry and the profiles can disagree for a moment: a refused
    // registration swap leaves the previous routes serving while resolution
    // has already moved on, so a selector may ask about a route the current
    // profiles no longer describe. It gets the key rather than nothing.
    expect(adapter.providerInfo('departed')).toEqual({ id: 'departed', name: 'departed' })
  })

  it('reports unsupported stop sequences rather than silently ignoring them', async () => {
    const server = await mockServer([])
    const ctx = await harness(server.url)
    const result = await assemble(ctx, { model: 'deepseek-v4-flash', messages: [], stop: ['END'] })
    expect(result.finish).toMatchObject({ kind: 'error', failure: { code: 'UNSUPPORTED_OPTION' } })
    expect(server.requests).toEqual([])
  })

  it('reports unknown catalog models before network I/O', async () => {
    const server = await mockServer([])
    const ctx = await harness(server.url)
    const result = await assemble(ctx, { model: 'not-in-the-catalog', messages: [] })
    expect(result.finish).toMatchObject({ kind: 'error', failure: { code: 'UNKNOWN_MODEL' } })
    expect(server.requests).toEqual([])
  })

  it('uses the catalog API implementation, including OpenAI Responses', async () => {
    const server = await mockServer([{ status: 401, body: JSON.stringify({ error: { message: 'expected mock failure' } }) }])
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {
      providers: { openai: { apiKeyEnv: 'PI_TEST_KEY', baseURL: `${server.url}/v1` } },
    })
    const result = await assemble(ctx, { provider: 'openai', model: 'gpt-4.1', messages: [] })
    expect(result.finish.kind).toBe('error')
    expect(server.paths).toEqual(['/v1/responses'])
  })

  it('resolves attachment and filesystem services mounted after the adapter when dispatching an image', async () => {
    const server = await mockServer([{ status: 401, body: JSON.stringify({ error: { message: 'expected mock failure' } }) }])
    const attachmentId = AttachmentId(`sha256:${'a'.repeat(64)}`)
    const ref: ImageAttachmentRef = {
      attachmentId,
      mediaType: 'image/png',
      bytes: 1,
      width: 1,
      height: 1,
    }
    const readImage = vi.fn((_ref: ImageAttachmentRef): Promise<StoredImageAttachment> =>
      Promise.resolve({ ref, data: Uint8Array.of(1) }))
    const readImageRequest = vi.fn((
      value: ImageAttachmentRef,
      _target: ImageRequestTarget,
      _signal?: AbortSignal,
    ): Promise<RequestImageAttachment> => (
      Promise.resolve({
        variantId: ImageVariantId(`sha256:${'b'.repeat(64)}`),
        attachment: value,
        data: Uint8Array.of(1),
        mediaType: value.mediaType,
        bytes: 1,
        width: value.width,
        height: value.height,
        depth: 'uchar',
        space: 'srgb',
        hasAlpha: true,
      })
    ))

    class LateAttachmentStore extends AttachmentStore {
      readonly imageLimits: ImageAttachmentLimits = {
        maxImageBytes: 1,
        maxImagesPerMessage: 1,
        maxMessageImageBytes: 1,
        maxImagePixels: 1,
        maxImageDimension: 2000,
        mediaTypes: ['image/png'],
      }

      validateImage(_input: SaveImageAttachment): Promise<void> {
        return Promise.reject(new Error('not used'))
      }

      saveImage(_input: SaveImageAttachment): Promise<ImageAttachmentRef> {
        return Promise.reject(new Error('not used'))
      }

      readImage(value: ImageAttachmentRef): Promise<StoredImageAttachment> {
        return readImage(value)
      }

      override imageHostPath(_ref: ImageAttachmentRef): string {
        return HOST_IMAGE_PATH
      }

      override readImageRequest(
        value: ImageAttachmentRef,
        policy: ImageRequestTarget,
        signal?: AbortSignal,
      ): Promise<RequestImageAttachment> {
        return readImageRequest(value, policy, signal)
      }
    }

    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {
      providers: { openai: { apiKeyEnv: 'PI_TEST_KEY', baseURL: `${server.url}/v1` } },
    })
    await ctx.plugin(LateAttachmentStore)
    await ctx.plugin(MappedFileSystem)

    const result = await assemble(ctx, {
      provider: 'openai',
      model: 'gpt-4.1',
      messages: [createUserMessage({
        content: [{ type: 'image', attachment: ref }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })

    expect(result.finish.kind).toBe('error')
    expect(readImageRequest).toHaveBeenCalledWith(ref, {
      width: 1,
      height: 1,
      maxBytes: 1024 * 1024,
    }, expect.any(AbortSignal))
    expect(JSON.stringify(server.requests[0])).toContain(MODEL_IMAGE_PATH)
    expect(server.paths).toEqual(['/v1/responses'])
  })

  it('forces one wire request for an SDK-retryable provider failure', async () => {
    const server = await mockServer([
      {
        status: 429,
        headers: { 'retry-after-ms': '1' },
        body: JSON.stringify({ error: { message: 'retryable provider failure' } }),
      },
      { status: 500, body: JSON.stringify({ error: { message: 'hidden SDK retry' } }) },
      { status: 500, body: JSON.stringify({ error: { message: 'second hidden SDK retry' } }) },
    ])
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {
      providers: { openai: { apiKeyEnv: 'PI_TEST_KEY', baseURL: `${server.url}/v1` } },
    })

    const result = await assemble(ctx, { provider: 'openai', model: 'gpt-4.1', messages: [] })

    expect(result.finish).toMatchObject({ kind: 'error' })
    expect(server.paths).toEqual(['/v1/responses'])
  })

  it('uses OpenAI Responses against an Azure project v1 path with its API key header', async () => {
    const server = await mockServer([{ status: 401, body: JSON.stringify({ error: { message: 'expected mock failure' } }) }])
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {
      providers: {
        openai: {
          apiKeyEnv: 'PI_TEST_KEY',
          baseURL: `${server.url}/api/projects/openai/openai/v1`,
          headers: { 'api-key': 'test-key', Authorization: '' },
        },
      },
    })
    const result = await assemble(ctx, { provider: 'openai', model: 'gpt-5.5', messages: [] })
    expect(result.finish.kind).toBe('error')
    expect(server.paths).toEqual(['/api/projects/openai/openai/v1/responses'])
    expect(server.headers[0]?.['api-key']).toBe('test-key')
    expect(server.headers[0]?.authorization).toBe('')
  })

  it.each([
    [401, 'AUTH'],
    [400, 'INVALID_REQUEST'],
    [429, 'RATE_LIMIT'],
    [500, 'SERVER'],
  ] as const)('maps HTTP %s failures to %s', async (status, code) => {
    const server = await mockServer([{ status, body: JSON.stringify({ error: { message: `provider ${status}` } }) }])
    const ctx = await harness(server.url)
    const result = await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(result.finish).toMatchObject({ kind: 'error', failure: { code } })
    expect(server.paths).toEqual(['/chat/completions'])
  })

  it('uses the resolved catalog context window for usage-based overflow detection', async () => {
    const model = getBuiltinModels('deepseek').find(candidate => candidate.id === 'deepseek-v4-flash')
    if (model === undefined) throw new Error('deepseek-v4-flash missing from pi-ai test catalog')
    const events = [
      '{"choices":[{"delta":{"role":"assistant","content":""},"index":0,"finish_reason":null}]}',
      JSON.stringify({
        choices: [{ delta: {}, index: 0, finish_reason: 'stop' }],
        usage: { prompt_tokens: model.contextWindow + 1, completion_tokens: 0 },
      }),
      '[DONE]',
    ]
    const server = await mockServer([{ events }])
    const ctx = await harness(server.url)

    const result = await assemble(ctx, { model: model.id, messages: [] })

    expect(result.finish).toEqual({
      kind: 'error',
      failure: {
        message: `pi-ai detected context overflow for model "${model.id}"`,
        code: CONTEXT_WINDOW_EXCEEDED_CODE,
      },
    })
  })

  it('repairs a Grok-style tool-call SSE event whose arguments contain a raw newline', async () => {
    const code = 'await tools.edit({\n  file_path: "state.rs",\n})'
    const inner = JSON.stringify({ description: 'edit', code })
    const brokenInner = inner.replaceAll('\\n', '\n')
    const events = [
      '{"choices":[{"delta":{"role":"assistant"},"index":0,"finish_reason":null}]}',
      JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call-1',
              type: 'function',
              function: { name: 'run_code', arguments: brokenInner },
            }],
          },
          index: 0,
          finish_reason: null,
        }],
      }).replaceAll('\\n', '\n'),
      '{"choices":[{"delta":{},"index":0,"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":3,"completion_tokens":8}}',
      '[DONE]',
    ]
    const server = await mockServer([{ events }])
    const ctx = await harness(server.url)
    const result = await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(result.finish).toMatchObject({ kind: 'tool-calls' })
    const tool = result.message.content.find(block => block.type === 'tool-call')
    expect(tool).toMatchObject({ type: 'tool-call', name: 'run_code' })
    expect(tool && 'arguments' in tool ? JSON.parse(tool.arguments) : undefined).toEqual({
      description: 'edit',
      code,
    })
  })

  it('repairs an unterminated tool-call arguments string instead of failing the turn', async () => {
    const events = [
      '{"choices":[{"delta":{"role":"assistant"},"index":0,"finish_reason":null}]}',
      '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"run_code","arguments":"{\\"description\\":\\"x\\",\\"code\\":\\"const x = 1"}}]},"index":0,"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":3,"completion_tokens":4}}',
      '[DONE]',
    ]
    const server = await mockServer([{ events }])
    const ctx = await harness(server.url)
    const result = await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(result.finish).toMatchObject({ kind: 'tool-calls' })
    const tool = result.message.content.find(block => block.type === 'tool-call')
    expect(tool).toMatchObject({ type: 'tool-call', name: 'run_code' })
  })

  it('stops the SDK request when the adapter idle watchdog expires', async () => {
    const server = await mockServer([{ events: textEvents, delayMs: 200 }])
    const ctx = await harness(server.url, { streamIdleTimeoutMs: 20 })

    const result = await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(result.finish).toMatchObject({ kind: 'error', failure: { code: 'TIMEOUT' } })
    await Promise.race([
      server.responseClosed,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => { reject(new Error('SDK request did not close after idle timeout')) }, 1_000)
      }),
    ])

    expect(server.paths).toEqual(['/chat/completions'])
    expect(server.closedResponses).toBe(1)
  })
})

describe('provider profile lifecycle', () => {
  it('keeps adapter helpers off the package root', () => {
    for (const helper of [
      'resolveProfiles',
      'toPiContext',
      'toPiReplayState',
      'toPiAssistant',
      'mapStopReason',
      'mapUsage',
      'toStreamChunks',
    ]) expect(LlmPiAi).not.toHaveProperty(helper)
  })

  it('registers every profile atomically and unregisters on dispose', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    const fiber = await ctx.plugin(LlmPiAi, {
      providers: {
        openai: {
          retryPolicy: {
            mode: 'always',
            backoff: { initialDelayMs: 25, maxDelayMs: 100, jitterRatio: 0.2 },
          },
        },
        anthropic: {},
      },
    })
    expect(ctx.llm.listProviders()).toEqual([
      { id: 'openai', name: 'openai' },
      { id: 'anthropic', name: 'anthropic' },
    ])
    expect(ctx.llm.providerRetryPolicy('openai')).toEqual({
      mode: 'always',
      initialDelayMs: 25,
      maxDelayMs: 100,
      jitterRatio: 0.2,
    })
    expect(ctx.llm.providerRetryPolicy('anthropic')).toMatchObject({
      mode: 'normal',
      maxRetries: 5,
    })
    await fiber.dispose()
    expect(ctx.llm.listProviders()).toEqual([])
  })

  it('exposes the installed pi-ai model catalog through provider-neutral metadata', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, { providers: { openai: {} } })
    const models = await ctx.llm.listModels('openai')
    expect(models.find(model => model.id === 'gpt-4.1')).toEqual({
      provider: 'openai', id: 'gpt-4.1', name: 'GPT-4.1',
      inputModalities: ['text', 'image'],
    })
    expect(models.every(model => model.provider === 'openai')).toBe(true)
    const info = await ctx.llm.resolveModelInfo('openai', 'gpt-4.1')
    expect(typeof info.context?.contextWindow).toBe('number')
  })

  it('exposes pi-ai model thinking levels verbatim without inventing a provider default', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {
      providers: { deepseek: {}, openai: {} },
    })

    await expect(ctx.llm.resolveModelInfo('deepseek', 'deepseek-v4-flash'))
      .resolves.toMatchObject({
        reasoning: {
          efforts: [
            { id: ReasoningEffortId('off'), name: 'Off' },
            { id: ReasoningEffortId('low'), name: 'Low' },
            { id: ReasoningEffortId('high'), name: 'High' },
            { id: ReasoningEffortId('max'), name: 'Max' },
          ],
        },
      })
    const extended = await ctx.llm.resolveModelInfo('openai', 'gpt-5.6-sol')
    expect(extended.reasoning?.efforts.map(effort => effort.id)).toEqual([
      ReasoningEffortId('off'),
      ReasoningEffortId('low'),
      ReasoningEffortId('medium'),
      ReasoningEffortId('high'),
      ReasoningEffortId('xhigh'),
      ReasoningEffortId('max'),
    ])
    // A catalog model without reasoning is the same case as a hand-declared
    // one: pi-ai reports the single level `off`, which translates to omitting
    // the reasoning option — exactly what naming no effort already does. The
    // capability is reported unavailable rather than offering that control.
    expect((await ctx.llm.resolveModelInfo('openai', 'gpt-4.1')).reasoning).toBeUndefined()
  })

  it('uses a supported profile reasoning value as the model default and rejects an unsupported one', async () => {
    const supported = new Context()
    await supported.plugin(LlmRuntime)
    await supported.plugin(LlmPiAi, {
      providers: { deepseek: { reasoning: 'max' } },
    })
    await expect(supported.llm.resolveModelInfo('deepseek', 'deepseek-v4-flash'))
      .resolves.toMatchObject({ reasoning: { defaultEffort: ReasoningEffortId('max') } })

    // A profile level this model cannot take DESCRIBES as no default rather
    // than failing: resolveModelInfo builds the model catalog, and a catalog
    // that throws takes its whole provider out of every picker — one mis-set
    // field would hide every model on the route, including the ones that do
    // support the level. The request path below is where it is refused.
    const unsupported = new Context()
    await unsupported.plugin(LlmRuntime)
    await unsupported.plugin(LlmPiAi, {
      providers: { deepseek: { reasoning: 'medium' } },
    })
    const described = await unsupported.llm.resolveModelInfo('deepseek', 'deepseek-v4-flash')
    expect(described.reasoning?.defaultEffort).toBeUndefined()
    expect(described.reasoning?.efforts.length).toBeGreaterThan(0)
    await expect(assemble(unsupported, {
      provider: 'deepseek', model: 'deepseek-v4-flash', messages: [],
    })).resolves.toMatchObject({
      finish: { kind: 'error', failure: { code: 'UNSUPPORTED_REASONING_EFFORT' } },
    })

    const disabled = new Context()
    await disabled.plugin(LlmRuntime)
    await disabled.plugin(LlmPiAi, {
      providers: { deepseek: { reasoning: 'off' } },
    })
    await expect(disabled.llm.resolveModelInfo('deepseek', 'deepseek-v4-flash'))
      .resolves.toMatchObject({ reasoning: { defaultEffort: ReasoningEffortId('off') } })
  })

  it('serves declared reasoning efforts to selectors and honours the profile default', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {
      providers: {
        'acme-gateway': {
          apiKeyEnv: 'PI_TEST_KEY',
          api: 'openai-completions',
          baseURL: 'https://acme.test/v1',
          reasoning: 'high',
          models: [{
            id: 'acme-think',
            contextWindow: 65_536,
            maxTokens: 4096,
            reasoningEfforts: { off: null, low: 'low', high: 'high' },
          }],
        },
      },
    })

    // Declared levels reach the same seam catalog metadata does, so the
    // effort picker works for a model pi-ai has never heard of.
    await expect(ctx.llm.resolveModelInfo('acme-gateway', 'acme-think')).resolves.toMatchObject({
      reasoning: {
        efforts: [
          { id: ReasoningEffortId('off'), name: 'Off' },
          { id: ReasoningEffortId('low'), name: 'Low' },
          { id: ReasoningEffortId('high'), name: 'High' },
        ],
        defaultEffort: ReasoningEffortId('high'),
      },
    })
  })

  it('sends the declared wire spelling and refuses undeclared levels before network I/O', async () => {
    vi.stubEnv('PI_TEST_KEY', 'test-key')
    const server = await mockServer([{ events: textEvents }])
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {
      providers: {
        'acme-gateway': {
          apiKeyEnv: 'PI_TEST_KEY',
          api: 'openai-completions',
          baseURL: `${server.url}/v1`,
          models: [{
            id: 'acme-think',
            contextWindow: 65_536,
            maxTokens: 4096,
            reasoningEfforts: { off: null, high: 'ultra' },
          }],
        },
      },
    })

    await assemble(ctx, {
      provider: 'acme-gateway',
      model: 'acme-think',
      reasoningEffort: ReasoningEffortId('high'),
      messages: [],
    })
    // The declared value, not the canonical level name, goes on the wire.
    expect(server.requests[0]).toMatchObject({ reasoning_effort: 'ultra' })

    const undeclared = await assemble(ctx, {
      provider: 'acme-gateway',
      model: 'acme-think',
      reasoningEffort: ReasoningEffortId('max'),
      messages: [],
    })
    expect(undeclared.finish).toMatchObject({
      kind: 'error',
      failure: { code: 'UNSUPPORTED_REASONING_EFFORT' },
    })
    expect(server.requests).toHaveLength(1)
  })

  it('dispatches the compat-switched dialect on a declared route', async () => {
    vi.stubEnv('PI_TEST_KEY', 'test-key')
    const server = await mockServer([{ events: textEvents }, { events: textEvents }])
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {
      providers: {
        'acme-gateway': {
          apiKeyEnv: 'PI_TEST_KEY',
          api: 'openai-completions',
          baseURL: `${server.url}/v1`,
          // Without the switch pi-ai guesses the dialect from the endpoint
          // URL, and a private gateway's URL says nothing.
          compat: { thinkingFormat: 'deepseek' },
          models: [{
            id: 'acme-think',
            contextWindow: 65_536,
            maxTokens: 4096,
            reasoningEfforts: { off: null, high: 'high' },
          }],
        },
      },
    })
    const prompt = (effort: string): Promise<unknown> => assemble(ctx, {
      provider: 'acme-gateway',
      model: 'acme-think',
      reasoningEffort: ReasoningEffortId(effort),
      messages: [],
    })

    await prompt('high')
    expect(server.requests[0]).toMatchObject({ thinking: { type: 'enabled' }, reasoning_effort: 'high' })

    await prompt('off')
    expect(server.requests[1]).toMatchObject({ thinking: { type: 'disabled' } })
    expect(server.requests[1]).not.toHaveProperty('reasoning_effort')
  })

  it('keeps the system role on a declared route whose gateway rejects the developer one', async () => {
    vi.stubEnv('PI_TEST_KEY', 'test-key')
    const server = await mockServer([{ events: textEvents }, { events: textEvents }])
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {
      providers: {
        'acme-gateway': {
          apiKeyEnv: 'PI_TEST_KEY',
          api: 'openai-completions',
          baseURL: `${server.url}/v1`,
          models: [
            // pi-ai sends the system prompt as `developer` to a reasoning
            // model whenever its URL detection says the endpoint is OpenAI —
            // which is what an unrecognized private URL resolves to. Most
            // OpenAI-compatible gateways reject that role.
            { id: 'acme-think', reasoningEfforts: { off: null, high: 'high' }, compat: { supportsDeveloperRole: false } },
            { id: 'acme-guess', reasoningEfforts: { off: null, high: 'high' } },
          ],
        },
      },
    })
    const roles = async (model: string): Promise<string[]> => {
      await assemble(ctx, {
        provider: 'acme-gateway',
        model,
        reasoningEffort: ReasoningEffortId('high'),
        system: 'you are a harness',
        messages: [],
      })
      const request = server.requests.at(-1) as { messages: { role: string }[] }
      return request.messages.map(message => message.role)
    }

    expect(await roles('acme-think')).toEqual(['system'])
    // The switch is the only thing that changes it: the same route, same
    // endpoint, same reasoning declaration still gets pi-ai's guess.
    expect(await roles('acme-guess')).toEqual(['developer'])
  })

  it('keeps the system role when a reasoning model names only the zai thinking format', async () => {
    vi.stubEnv('PI_TEST_KEY', 'test-key')
    const server = await mockServer([{ events: textEvents }])
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {
      providers: {
        'acme-gateway': {
          apiKeyEnv: 'PI_TEST_KEY',
          api: 'openai-completions',
          baseURL: `${server.url}/v1`,
          models: [{
            id: 'glm-flash',
            reasoningEfforts: { off: null, max: 'max' },
            compat: { thinkingFormat: 'zai', supportsReasoningEffort: true },
          }],
        },
      },
    })
    await assemble(ctx, {
      provider: 'acme-gateway',
      model: 'glm-flash',
      reasoningEffort: ReasoningEffortId('max'),
      system: 'you are a harness',
      messages: [],
    })
    const request = server.requests.at(-1) as { messages: { role: string }[] }
    expect(request.messages.map(message => message.role)).toEqual(['system'])
  })

  it('sends a declared off value as the effort parameter instead of omitting it', async () => {
    vi.stubEnv('PI_TEST_KEY', 'test-key')
    const server = await mockServer([{ events: textEvents }])
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {
      providers: {
        'acme-gateway': {
          apiKeyEnv: 'PI_TEST_KEY',
          api: 'openai-completions',
          baseURL: `${server.url}/v1`,
          models: [{
            id: 'acme-think',
            contextWindow: 65_536,
            maxTokens: 4096,
            reasoningEfforts: { off: 'none', high: 'high' },
          }],
        },
      },
    })

    // The adapter strips a selected Off to "no reasoning option", and pi-ai's
    // dispatch reads thinkingLevelMap.off exactly then — so the declared value
    // still reaches the wire, which is the README's promise for `off: none`.
    await assemble(ctx, {
      provider: 'acme-gateway',
      model: 'acme-think',
      reasoningEffort: ReasoningEffortId('off'),
      messages: [],
    })
    expect(server.requests[0]).toMatchObject({ reasoning_effort: 'none' })
  })

  it('holds back reasoning_effort when the endpoint cannot take it', async () => {
    vi.stubEnv('PI_TEST_KEY', 'test-key')
    const server = await mockServer([{ events: textEvents }])
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {
      providers: {
        'acme-gateway': {
          apiKeyEnv: 'PI_TEST_KEY',
          api: 'openai-completions',
          baseURL: `${server.url}/v1`,
          compat: { supportsReasoningEffort: false },
          models: [{
            id: 'acme-think',
            contextWindow: 65_536,
            maxTokens: 4096,
            reasoningEfforts: { off: null, high: 'high' },
          }],
        },
      },
    })

    await assemble(ctx, {
      provider: 'acme-gateway',
      model: 'acme-think',
      reasoningEffort: ReasoningEffortId('high'),
      messages: [],
    })
    expect(server.requests[0]).not.toHaveProperty('reasoning_effort')
  })

  it('accepts absent credentials for pi-ai ambient authentication', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'ambient-key')
    const server = await mockServer([{ events: textEvents }])
    // A profile that names no reference at all is the one case that defers to
    // pi-ai's own provider-native discovery.
    const ctx = await harness(server.url, { apiKeyEnv: undefined })
    await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(server.headers[0]?.authorization).toBe('Bearer ambient-key')
  })

  it('falls back to the ambient environment for apiKeyEnv without the credentials seam', async () => {
    vi.stubEnv('PI_CUSTOM_REF_KEY', 'custom-ref-key')
    const server = await mockServer([{ events: textEvents }])
    const ctx = await harness(server.url, { apiKey: undefined, apiKeyEnv: 'PI_CUSTOM_REF_KEY' })
    await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(server.headers[0]?.authorization).toBe('Bearer custom-ref-key')
  })

  it('fails a named-but-missing apiKeyEnv instead of using another ambient key', async () => {
    // The exact confusion this guards: the named reference is empty while an
    // unrelated provider key sits in the environment. Deferring to pi-ai's own
    // discovery here would authenticate as another tenant.
    vi.stubEnv('PI_CUSTOM_REF_KEY', '')
    vi.stubEnv('DEEPSEEK_API_KEY', 'ambient-key')
    const server = await mockServer([{ events: textEvents }])
    const ctx = await harness(server.url, { apiKey: undefined, apiKeyEnv: 'PI_CUSTOM_REF_KEY' })
    const first = await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(first.finish).toMatchObject({ kind: 'error', failure: { code: 'MISSING_CREDENTIAL' } })
    const second = await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(second.finish.kind).toBe('error')
    if (second.finish.kind !== 'error') throw new Error('expected an error finish')
    expect(second.finish.failure.message).toMatch(/provider route "deepseek".*PI_CUSTOM_REF_KEY/s)
    expect(server.requests).toHaveLength(0)
  })

  it('validates empty, underspecified, legacy-shaped, and explicitly blank profiles', () => {
    expect(DEFAULT_MAX_REQUEST_IMAGE_BYTES).toBe(20 * 1024 * 1024)
    // Empty and omitted dicts are the dormant zero-route posture, not errors.
    expect(resolveProfiles({}).size).toBe(0)
    expect(resolveProfiles(undefined).size).toBe(0)
    expect(() => resolveProfiles({ '': {} })).toThrow(/non-empty/)
    // A route the installed catalog does not ship is allowed, but it has no
    // defaults to fall back on: it must describe its own models.
    expect(() => resolveProfiles({ 'not-real': {} })).toThrow(/resolves no models/)
    // The pre-release array shape and its per-profile provider field fail
    // loud with migration directions instead of half-working.
    expect(() => resolveProfiles([{ provider: 'openai' }] as never)).toThrow(/dict keyed by provider/)
    expect(() => resolveProfiles({ openai: { provider: 'openai' } as never })).toThrow(/moved to the providers dict key/)
    expect(() => resolveProfiles({ openai: { baseURL: '' } })).toThrow(/empty baseURL/)
    expect(() => resolveProfiles({ openai: { apiKeyEnv: 'not-a-var!' } })).toThrow(/must match/)
    expect(() => resolveProfiles({ openai: { maxRequestImageBytes: 0 } })).toThrow(/maxRequestImageBytes/)
    expect(resolveProfiles({ openai: {} }).get('openai')?.maxRequestImageBytes)
      .toBe(DEFAULT_MAX_REQUEST_IMAGE_BYTES)
    expect(resolveProfiles({ openai: { maxRequestImageBytes: 1024 } }).get('openai')?.maxRequestImageBytes)
      .toBe(1024)
  })

  it.each([
    ['bad header name', 'value'],
    ['x-company', 'line\nbreak'],
    ['x-company', '部署'],
  ])('rejects provider header %j when Fetch cannot represent the entry', (name, value) => {
    expect(() => resolveProfiles({ openai: { headers: { [name]: value } } }))
      .toThrow(`provider "openai" header "${name}" is not valid for Fetch`)
  })

  it.each(['maxRetries', 'maxRetryDelayMs'] as const)(
    'rejects removed profile field %s instead of silently restoring hidden SDK retries',
    async (field) => {
      const legacy = { [field]: 2 }
      expect(() => resolveProfiles({ openai: legacy })).toThrow(/removed.*agent recovery/i)
      const ctx = new Context()
      await ctx.plugin(LlmRuntime)
      await expect(ctx.plugin(LlmPiAi, { providers: { openai: legacy } }))
        .rejects.toThrow(/removed.*agent recovery/i)
    },
  )

  it('rejects invalid stream tunables at plugin load', async () => {
    const invalid = [
      { timeoutMs: -1 },
      { websocketConnectTimeoutMs: -1 },
      { streamIdleTimeoutMs: 0 },
      { streamIdleTimeoutMs: Number.NaN },
      { streamIdleTimeoutMs: MAX_TIMER_DELAY_MS + 1 },
      { maxRequestImageBytes: 0 },
      { maxRequestImageBytes: 1.5 },
      { maxRequestImageBytes: Number.NaN },
    ]
    for (const entry of invalid) {
      const ctx = new Context()
      await ctx.plugin(LlmRuntime)
      await expect(ctx.plugin(LlmPiAi, { providers: { openai: { ...entry } } }))
        .rejects.toThrow()
    }
  })

  it('rejects invalid nested retryPolicy at the provider-profile boundary', async () => {
    expect(() => resolveProfiles({
      openai: { retryPolicy: { mode: 'always', backoff: { jitterRatio: -1 } } },
    })).toThrow(/retryPolicy\.backoff\.jitterRatio/)

    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await expect(ctx.plugin(LlmPiAi, {
      providers: { openai: { retryPolicy: { mode: 'normal', maxRetries: -1 } } },
    })).rejects.toThrow(/retryPolicy/)
    expect(ctx.llm.listProviders()).toEqual([])
  })

  it('constructs the adapter directly and rejects routes it does not own', async () => {
    const adapter = adapterOf({ openai: {} })
    await expect(adapter.listModels('anthropic')).rejects.toMatchObject({ code: 'NO_ADAPTER' })
    await expect(adapter.resolveModel('anthropic', 'claude-sonnet-4'))
      .rejects.toMatchObject({ code: 'NO_ADAPTER' })
    await expect(adapter.resolveModel('openai', 'not-a-catalog-model'))
      .rejects.toMatchObject({ code: 'UNKNOWN_MODEL' })
    await expect((async () => {
      for await (const _chunk of adapter.stream({ provider: 'anthropic', model: 'claude-sonnet-4', messages: [] })) { /* drain */ }
    })()).rejects.toMatchObject({ code: 'NO_ADAPTER' })
    expect(new LlmError('x', 'X')).toBeInstanceOf(Error)
  })

  it('rejects unsupported or unresolved image input before provider I/O', async () => {
    const adapter = adapterOf({ openai: {}, deepseek: {} })
    const drain = async (options: Parameters<PiAiAdapter['stream']>[0]): Promise<void> => {
      for await (const _chunk of adapter.stream(options)) { /* drain */ }
    }

    await expect(drain({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      messages: [createUserMessage({
        content: [{ type: 'image', attachment: IMAGE_REF }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
    await expect(drain({
      provider: 'openai',
      model: 'gpt-4.1',
      messages: [createUserMessage({
        content: [{ type: 'image', attachment: IMAGE_REF }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
    await expect(drain({
      provider: 'openai',
      model: 'gpt-4.1',
      messages: [createUserMessage({
        content: [{
          type: 'tool-result',
          toolCallId: 'call-outer' as never,
          content: [{
            type: 'tool-result',
            toolCallId: 'call-inner' as never,
            content: [{ type: 'image', attachment: IMAGE_REF }],
          }],
        }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
  })

  it('validates profiles at the shared resolver boundary', () => {
    expect(() => resolveProfiles({
      openai: { streamIdleTimeoutMs: 0 },
    })).toThrow(/streamIdleTimeoutMs.*positive finite/)
    expect(() => resolveProfiles({
      openai: { streamIdleTimeoutMs: MAX_TIMER_DELAY_MS + 1 },
    })).toThrow(/streamIdleTimeoutMs.*no greater/)
  })
})

describe('abort wiring', () => {
  it('preserves an unknown pre-dispatch adapter Error exactly', async () => {
    const original = new Error('SDK context conversion exploded')
    const message = Object.defineProperty({}, 'content', {
      get() { throw original },
    })
    const adapter = adapterOf({ deepseek: {} })
    const drain = async (): Promise<void> => {
      for await (const _chunk of adapter.stream({
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
        messages: [message as never],
      })) { /* drain */ }
    }

    await expect(drain()).rejects.toBe(original)
  })

  it('lets a concurrent caller abort classify a pre-dispatch adapter failure', async () => {
    const controller = new AbortController()
    const original = new Error('conversion lost its caller')
    const message = Object.defineProperty({}, 'content', {
      get() {
        controller.abort('caller cancelled during conversion')
        throw original
      },
    })
    const adapter = adapterOf({ deepseek: {} })
    const drain = async (): Promise<void> => {
      for await (const _chunk of adapter.stream({
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
        messages: [message as never],
        signal: controller.signal,
      })) { /* drain */ }
    }

    await expect(drain()).rejects.toMatchObject({ code: 'ABORTED', cause: original })
  })

  it('resolves catalog endpoints without an override before honoring pre-abort', async () => {
    const adapter = adapterOf({ deepseek: {} })
    const controller = new AbortController()
    controller.abort('already stopped')
    const chunks = []
    for await (const chunk of adapter.stream({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      messages: [],
      signal: controller.signal,
    })) chunks.push(chunk)
    expect(chunks.at(-1)).toMatchObject({
      type: 'finish',
      reason: { kind: 'aborted', failure: { code: 'ABORTED' } },
    })
  })

  it('honors a pre-aborted caller signal', async () => {
    const server = await mockServer([{ events: textEvents, delayMs: 20 }])
    const ctx = await harness(server.url)
    const controller = new AbortController()
    controller.abort('already stopped')
    const result = await assemble(ctx, { model: 'deepseek-v4-flash', messages: [], signal: controller.signal })
    expect(result.finish.kind).toBe('aborted')
  })

  it('forwards an abort that arrives while provider streaming is active', async () => {
    const server = await mockServer([{ events: textEvents, delayMs: 30 }])
    const ctx = await harness(server.url)
    const controller = new AbortController()
    const resultPromise = assemble(ctx, {
      model: 'deepseek-v4-flash', messages: [], signal: controller.signal,
    })
    setTimeout(() => { controller.abort('stopped during stream') }, 10)
    const result = await resultPromise
    expect(result.finish.kind).toBe('aborted')
  })

  it('aborts upstream when a consumer stops early', async () => {
    const server = await mockServer([{ events: textEvents, delayMs: 30 }])
    const ctx = await harness(server.url)
    for await (const chunk of ctx.llm.stream({ provider: 'deepseek', model: 'deepseek-v4-flash', messages: [] })) {
      if (chunk.type === 'block-start') break
    }
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(server.requests).toHaveLength(1)
  })
})

describe('video input', () => {
  const videoGateway = (baseURL: string, overrides: Record<string, unknown> = {}): Record<string, LlmPiAi.PiAiProviderProfile> => ({
    'video-gateway': {
      apiKeyEnv: 'PI_TEST_KEY',
      api: 'openai-completions',
      baseURL,
      models: [{ id: 'glm-5.3-flash', input: ['text', 'image', 'video'], contextWindow: 131_072, maxTokens: 8_192 }],
      ...overrides,
    },
  })

  const drain = async (adapter: PiAiAdapter, options: Parameters<PiAiAdapter['stream']>[0]): Promise<unknown> =>
    (async () => {
      for await (const _chunk of adapter.stream(options)) { /* drain */ }
    })()

  it('rejects video for a model whose modalities omit it before provider I/O', async () => {
    const adapter = adapterOf({
      'acme-gateway': {
        api: 'openai-completions',
        baseURL: 'https://acme.test/v1',
        models: [{ id: 'acme-text', contextWindow: 65_536, maxTokens: 4_096 }],
      },
    })
    await expect(drain(adapter, {
      provider: 'acme-gateway',
      model: 'acme-text',
      messages: [createUserMessage({
        content: [{ type: 'video', attachment: VIDEO_REF }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })).rejects.toThrow('pi-ai model "acme-text" does not support video input')
  })

  it('rejects video without the durable attachment service before provider I/O', async () => {
    const server = await mockServer([])
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {
      providers: {
        'video-gateway': {
          apiKeyEnv: 'PI_TEST_KEY',
          api: 'openai-completions',
          baseURL: `${server.url}/v1`,
          models: [{ id: 'glm-5.3-flash', input: ['text', 'image', 'video'], contextWindow: 131_072, maxTokens: 8_192 }],
        },
      },
    })

    const result = await assemble(ctx, {
      provider: 'video-gateway',
      model: 'glm-5.3-flash',
      messages: [createUserMessage({
        content: [{ type: 'video', attachment: VIDEO_REF }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })
    expect(result.finish).toMatchObject({ kind: 'error', failure: { code: 'UNSUPPORTED_CONTENT' } })
    expect(server.requests).toEqual([])
  })

  it('rejects a video payload over maxRequestVideoBytes naming the size', async () => {
    const adapter = adapterWithStore({
      'acme-gateway': {
        api: 'openai-completions',
        baseURL: 'https://acme.test/v1',
        maxRequestVideoBytes: 3,
        models: [{ id: 'acme-vision', input: ['text', 'image', 'video'], contextWindow: 65_536, maxTokens: 4_096 }],
      },
    })
    await expect(drain(adapter, {
      provider: 'acme-gateway',
      model: 'acme-vision',
      messages: [createUserMessage({
        content: [{ type: 'video', attachment: VIDEO_REF }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })).rejects.toThrow(/video request payload 4 bytes exceeds.*maxRequestVideoBytes 3/s)
  })

  it.skip('injects video_url wire items for user videos and leaves marker-free bodies untouched', async () => {
    const server = await mockServer([{ events: textEvents }, { events: textEvents }])
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, { providers: videoGateway(`${server.url}/v1`) })
    await ctx.plugin(RequestOnlyAttachmentStore)

    await assemble(ctx, {
      provider: 'video-gateway',
      model: 'glm-5.3-flash',
      messages: [createUserMessage({
        content: [{ type: 'text', text: 'describe' }, { type: 'video', attachment: VIDEO_REF }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })
    expect(server.requests[0]).toMatchObject({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'describe' },
          { type: 'video_url', video_url: { url: 'QUJD' } },
        ],
      }],
    })
    expect(JSON.stringify(server.requests[0])).not.toContain('dsh-video-request')

    // A marker-free request on the same lease pays only the fast-path scan.
    await assemble(ctx, {
      provider: 'video-gateway',
      model: 'glm-5.3-flash',
      messages: [createUserMessage({
        content: [{ type: 'text', text: 'plain' }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })
    expect(server.requests[1]).toMatchObject({
      messages: [{ role: 'user', content: 'plain' }],
    })
  })

  it.skip('moves tool-result videos into the synthetic user message on the wire', async () => {
    const server = await mockServer([{ events: textEvents }])
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, { providers: videoGateway(`${server.url}/v1`) })
    await ctx.plugin(RequestOnlyAttachmentStore)

    await assemble(ctx, {
      provider: 'video-gateway',
      model: 'glm-5.3-flash',
      messages: [createUserMessage({
        content: [{
          type: 'tool-result',
          toolCallId: 'call-video' as never,
          content: [
            { type: 'text', text: 'Video sha256:bbb: clip.mp4 (video/mp4, 3 bytes)' },
            { type: 'video', attachment: VIDEO_REF },
          ],
        }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })

    const wire = server.requests[0] as { messages: { role: string; content: unknown; tool_call_id?: string }[] }
    expect(wire.messages.map(message => message.role)).toEqual(['tool', 'user'])
    expect(wire.messages[0]).toMatchObject({ tool_call_id: 'call-video' })
    expect(wire.messages[0]?.content).not.toContain('dsh-video-request')
    expect(wire.messages[1]?.content).toEqual([
      { type: 'text', text: 'Attached video(s) from tool result:' },
      { type: 'video_url', video_url: { url: 'QUJD' } },
    ])
  })

  it('shares the SSE repair lease with the video rewrite without stacking wrappers', async () => {
    // Both stages ride one pipeline wrapper for the stream lifetime; the SSE
    // repair must keep working while the video rewrite is installed.
    const broken = '{"choices":[{"delta":{"content":"x\\n y"},"index":0,"finish_reason":null}]}'
    const events = [
      '{"choices":[{"delta":{"role":"assistant","content":""},"index":0,"finish_reason":null}]}',
      broken.replaceAll('\\n', '\n'),
      '{"choices":[{"delta":{},"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
      '[DONE]',
    ]
    const server = await mockServer([{ events }])
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, { providers: videoGateway(`${server.url}/v1`) })
    await ctx.plugin(RequestOnlyAttachmentStore)

    const result = await assemble(ctx, {
      provider: 'video-gateway',
      model: 'glm-5.3-flash',
      messages: [createUserMessage({
        content: [{ type: 'video', attachment: VIDEO_REF }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })
    expect(result.message.content).toEqual([{ type: 'text', text: 'x\n y' }])
  })

  it('defaults and validates maxRequestVideoBytes beside the image budgets', () => {
    expect(DEFAULT_MAX_REQUEST_VIDEO_BYTES).toBe(100 * 1024 * 1024)
    expect(resolveProfiles(videoGateway('https://acme.test/v1')).get('video-gateway')?.maxRequestVideoBytes)
      .toBe(DEFAULT_MAX_REQUEST_VIDEO_BYTES)
    expect(resolveProfiles(videoGateway('https://acme.test/v1', { maxRequestVideoBytes: 1024 })).get('video-gateway')?.maxRequestVideoBytes)
      .toBe(1024)
    expect(() => resolveProfiles(videoGateway('https://acme.test/v1', { maxRequestVideoBytes: 0 })))
      .toThrow(/maxRequestVideoBytes must be a positive integer/)
    expect(() => resolveProfiles(videoGateway('https://acme.test/v1', { maxRequestVideoBytes: 1.5 })))
      .toThrow(/maxRequestVideoBytes must be a positive integer/)
    expect(() => resolveProfiles(videoGateway('https://acme.test/v1', { maxRequestVideoBytes: Number.NaN })))
      .toThrow(/maxRequestVideoBytes must be a positive integer/)
  })
})
