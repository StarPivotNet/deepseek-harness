/**
 * The `read_video` tool over the REAL local filesystem and attachment store:
 * extension routing, the strict video-modality gate (every refusal arm),
 * durable commit + video-block rendering, attachment admission failures, and
 * the registration surface beside `read_image`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { provideWorkingDirectoryFixture } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId, LlmAdapter, LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as FsPolicy from '@deepseek-ai/dsh-fs-observation-policy'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { AttachmentError, AttachmentId, AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type {
  ImageAttachmentLimits,
  ImageAttachmentRef,
  SaveImageAttachment,
  StoredImageAttachment,
  VideoAttachmentLimits,
  VideoAttachmentRef,
  SaveVideoAttachment,
  StoredVideoAttachment,
} from '@deepseek-ai/dsh-attachment'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import {
  applyReadVideoTool,
  formatVideoReadOutput,
  videoMediaTypeForPath,
  videoRefFromValue,
} from '../src/read-video.ts'

/** Minimal ISO-BMFF `ftyp` box carrying one major brand. */
function ftyp(brand: string): Buffer {
  const box = Buffer.alloc(20)
  box.writeUInt32BE(box.byteLength, 0)
  box.write('ftyp', 4, 'ascii')
  box.write(brand, 8, 'ascii')
  box.writeUInt32BE(0, 12)
  box.write(brand, 16, 'ascii')
  return box
}

/** Minimal MP4 source: the common `isom` major brand. */
const MP4 = ftyp('isom')
/** Minimal QuickTime source: the `qt  ` major brand. */
const MOV = ftyp('qt  ')
/** Minimal Matroska source: an EBML header with DocType `matroska`. */
const MKV = (() => {
  const element = (id: number[], payload: Buffer): Buffer =>
    Buffer.concat([Buffer.from(id), Buffer.from([0x80 | payload.byteLength]), payload])
  const content = Buffer.concat([
    element([0x42, 0x86], Buffer.from([1])),
    element([0x42, 0xf7], Buffer.from([1])),
    element([0x42, 0x82], Buffer.from('matroska', 'ascii')),
  ])
  return Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80 | content.byteLength]), content])
})()
/** 1x1 PNG bytes: a non-video payload with a readable header. */
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64')

const testToolSignal = new AbortController().signal

/** Exact-route fake adapter; `stream` is unreachable in these tests. */
class CatalogAdapter extends LlmAdapter {
  constructor(
    private readonly models: LlmModelInfo[],
    private readonly resolvedModels: LlmModelInfo[] = models,
  ) {
    super()
  }

  override listModels(_provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(this.models)
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const resolved = this.resolvedModels.find(candidate => candidate.id === model)
    return Promise.resolve({
      provider,
      id: model,
      name: resolved?.name ?? model,
      ...resolved?.inputModalities === undefined ? {} : { inputModalities: [...resolved.inputModalities] },
    })
  }

  override stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new Error('read_video tests never stream')
  }
}

let dir: string
let home: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-read-video-'))
  home = await mkdtemp(join(tmpdir(), 'dsh-read-video-home-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
})

interface SetupOptions {
  models?: LlmModelInfo[]
  resolvedModels?: LlmModelInfo[]
  attachments?: boolean
  llm?: boolean
  storeConfig?: { maxVideoBytes?: number; maxMessageVideoBytes?: number }
}

async function setup(options: SetupOptions = {}) {
  const ctx = new Context()
  provideWorkingDirectoryFixture(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime, { mode: 'native' })
  await ctx.plugin(LocalFileSystem, { cwd: dir })
  await ctx.plugin(FsPolicy)
  if (options.attachments !== false) {
    await ctx.plugin(LocalAttachmentStore, { dshHome: home, ...options.storeConfig })
  }
  if (options.llm !== false) {
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['visual'], new CatalogAdapter(options.models ?? [
      { provider: 'visual', id: 'video-model', name: 'Video', inputModalities: ['text', 'image', 'video'] },
      { provider: 'visual', id: 'image-model', name: 'Image', inputModalities: ['text', 'image'] },
      { provider: 'visual', id: 'text-model', name: 'Text', inputModalities: ['text'] },
      { provider: 'visual', id: 'legacy-model', name: 'Legacy' },
    ], options.resolvedModels))
  }
  await ctx.plugin(ToolFs)
  return ctx
}

/** A fake calling agent pinned to one routed provider/model. */
function agentOn(model: string | undefined, provider = 'visual', messages: readonly Message[] = []): object {
  return {
    options: {},
    session: {
      header: { cwd: dir },
      requestHeader: () => (model === undefined ? undefined : { config: { provider, model } }),
      deriveMessages: () => [...messages],
      append: () => undefined,
    },
  }
}

let callCounter = 0
function call(ctx: Context, name: string, args: unknown, agent?: object) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId(`vid-call-${++callCounter}`),
    name,
    arguments: args,
    ...agent ? { agent: agent as never } : {},
  })
}

function readVideo(ctx: Context, args: unknown, agent?: object) {
  return call(ctx, 'read_video', args, agent)
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text).join('')
}

describe('videoMediaTypeForPath', () => {
  it('maps the three extensions case-insensitively and rejects everything else', () => {
    expect(videoMediaTypeForPath('a.mp4')).toBe('video/mp4')
    expect(videoMediaTypeForPath('b.MP4')).toBe('video/mp4')
    expect(videoMediaTypeForPath('c.mkv')).toBe('video/x-matroska')
    expect(videoMediaTypeForPath('d.Mov')).toBe('video/quicktime')
    expect(videoMediaTypeForPath('note.txt')).toBeUndefined()
    expect(videoMediaTypeForPath('clip.webm')).toBeUndefined()
    expect(videoMediaTypeForPath('mp4')).toBeUndefined()
  })
})

describe('videoRefFromValue', () => {
  it('re-brands with and without the optional display name', () => {
    const base = { attachmentId: 'sha256:00', mediaType: 'video/mp4' as const, bytes: 1 }
    expect(videoRefFromValue(base)).toEqual(base)
    expect(videoRefFromValue({ ...base, name: 'a.mp4' })).toEqual({ ...base, name: 'a.mp4' })
  })
})

describe('read_video happy path', () => {
  it('commits the bytes durably and renders the envelope beside a video block', async () => {
    await writeFile(join(dir, 'clip.mp4'), MP4)
    const ctx = await setup()
    const result = await readVideo(ctx, { file_path: 'clip.mp4' }, agentOn('video-model'))

    expect(result.isError).toBe(false)
    expect(result.content).toHaveLength(2)
    const video = result.content[1] as { type: string; attachment: VideoAttachmentRef }
    expect(video.type).toBe('video')
    expect(video.attachment.mediaType).toBe('video/mp4')
    expect(video.attachment.bytes).toBe(MP4.length)
    expect(video.attachment.name).toBe('clip.mp4')
    expect(video.attachment.attachmentId).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(text(result)).toBe(formatVideoReadOutput(join(dir, 'clip.mp4'), {
      attachmentId: video.attachment.attachmentId,
      mediaType: 'video/mp4',
      bytes: MP4.length,
    }))
    expect(text(result)).toContain('<type>video</type>')
    expect(text(result)).toContain(`video/mp4 video, ${MP4.length} bytes`)

    // The committed object must read back verbatim through the store.
    const attachments = ctx.get('attachments')
    if (attachments === undefined) throw new Error('expected the attachment service')
    const stored = await attachments.readVideo(video.attachment)
    expect(Buffer.from(stored.data)).toEqual(MP4)
  })

  it.each([
    ['movie.mov', MOV, 'video/quicktime'],
    ['film.mkv', MKV, 'video/x-matroska'],
  ] as const)('commits every accepted container: %s', async (name, bytes, mediaType) => {
    await writeFile(join(dir, name), bytes)
    const ctx = await setup()
    const result = await readVideo(ctx, { file_path: name }, agentOn('video-model'))
    expect(result.isError).toBe(false)
    const video = result.content[1] as { attachment: VideoAttachmentRef }
    expect(video.attachment.mediaType).toBe(mediaType)
    expect(video.attachment.bytes).toBe(bytes.length)
  })

  it('emits fs/observed for the read video', async () => {
    await writeFile(join(dir, 'clip.mp4'), MP4)
    const ctx = await setup()
    const observed: string[] = []
    ctx.on('fs/observed', target => void observed.push(target.displayPath))
    await readVideo(ctx, { file_path: 'clip.mp4' }, agentOn('video-model'))
    expect(observed).toEqual([join(dir, 'clip.mp4')])
  })

  it('falls back to agent options when no request header exists yet', async () => {
    await writeFile(join(dir, 'clip.mp4'), MP4)
    const ctx = await setup()
    const agent = {
      options: { provider: 'visual', model: 'video-model' },
      session: { header: { cwd: dir }, requestHeader: () => undefined },
    }
    const result = await readVideo(ctx, { file_path: 'clip.mp4' }, agent)
    expect(result.isError).toBe(false)
  })
})

describe('strict video-modality gate', () => {
  it('accepts an exact video route even when the advisory model catalog omits it', async () => {
    await writeFile(join(dir, 'clip.mp4'), MP4)
    const ctx = await setup({
      models: [],
      resolvedModels: [
        { provider: 'visual', id: 'hidden-video', name: 'Hidden Video', inputModalities: ['text', 'image', 'video'] },
      ],
    })
    const result = await readVideo(ctx, { file_path: 'clip.mp4' }, agentOn('hidden-video'))
    expect(result.isError).toBe(false)
  })

  it.each([
    ['an image-capable but video-less model', 'image-model'],
    ['a text-only model', 'text-model'],
    ['a model without declared modalities', 'legacy-model'],
    ['a model absent from the catalog', 'unknown-model'],
  ])('refuses on %s', async (_label, model) => {
    await writeFile(join(dir, 'clip.mp4'), MP4)
    const ctx = await setup()
    const result = await readVideo(ctx, { file_path: 'clip.mp4' }, agentOn(model))
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('does not declare video input')
  })

  it('refuses when the route cannot be resolved (no agent, or no header and no options)', async () => {
    await writeFile(join(dir, 'clip.mp4'), MP4)
    const ctx = await setup()
    const noAgent = await readVideo(ctx, { file_path: 'clip.mp4' })
    expect(noAgent.isError).toBe(true)
    expect(text(noAgent)).toContain('route could not be resolved')

    const noRoute = await readVideo(ctx, { file_path: 'clip.mp4' }, agentOn(undefined))
    expect(noRoute.isError).toBe(true)
    expect(text(noRoute)).toContain('route could not be resolved')
  })

  it('refuses when no llm service is mounted', async () => {
    await writeFile(join(dir, 'clip.mp4'), MP4)
    const ctx = await setup({ llm: false })
    const result = await readVideo(ctx, { file_path: 'clip.mp4' }, agentOn('video-model'))
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('route could not be resolved')
  })
})

describe('argument and service preconditions', () => {
  it('rejects an empty path and a non-video extension', async () => {
    const ctx = await setup()
    const empty = await readVideo(ctx, { file_path: '   ' }, agentOn('video-model'))
    expect(empty.isError).toBe(true)
    expect(text(empty)).toContain('non-empty')

    const nonVideo = await readVideo(ctx, { file_path: 'notes.txt' }, agentOn('video-model'))
    expect(nonVideo.isError).toBe(true)
    expect(text(nonVideo)).toContain('only accepts MP4/MKV/MOV paths')

    const webm = await readVideo(ctx, { file_path: 'clip.webm' }, agentOn('video-model'))
    expect(webm.isError).toBe(true)
    expect(text(webm)).toContain('only accepts MP4/MKV/MOV paths')
  })

  it('refuses when no attachment service is mounted', async () => {
    await writeFile(join(dir, 'clip.mp4'), MP4)
    const ctx = await setup({ attachments: false })
    expect(ctx.tools.get('read_video')).toBeUndefined()
    expect(ctx.tools.schemas().map(schema => schema.name)).not.toContain('read_video')
    const result = await readVideo(ctx, { file_path: 'clip.mp4' }, agentOn('video-model'))
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('unknown tool "read_video"')
  })

  it('defensively refuses execution without an attachment service', async () => {
    await writeFile(join(dir, 'clip.mp4'), MP4)
    const ctx = await setup({ attachments: false })
    applyReadVideoTool(ctx)
    const result = await readVideo(ctx, { file_path: 'clip.mp4' }, agentOn('video-model'))
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('no attachment service is mounted')
  })

  it('refuses a media type the deployment does not accept', async () => {
    /** Store whose deployment accepts Matroska video only. */
    class MatroskaOnlyStore extends AttachmentStore {
      readonly imageLimits: ImageAttachmentLimits = Object.freeze({
        maxImageBytes: 1024,
        maxImagesPerMessage: 1,
        maxMessageImageBytes: 1024,
        maxImagePixels: 100,
        maxImageDimension: 2000,
        mediaTypes: Object.freeze([] as const),
      })

      override readonly videoLimits: VideoAttachmentLimits = Object.freeze({
        maxVideoBytes: 1024,
        maxVideosPerMessage: 1,
        maxMessageVideoBytes: 1024,
        mediaTypes: Object.freeze(['video/x-matroska'] as const),
      })

      validateImage(_input: SaveImageAttachment): Promise<void> {
        throw new Error('unreachable: image admission never runs in this test')
      }

      saveImage(_input: SaveImageAttachment): Promise<ImageAttachmentRef> {
        throw new Error('unreachable: image admission never runs in this test')
      }

      readImage(_ref: ImageAttachmentRef): Promise<StoredImageAttachment> {
        throw new Error('unreachable: image admission never runs in this test')
      }

      override validateVideo(_input: SaveVideoAttachment): Promise<void> {
        throw new Error('unreachable: admission refuses before validation')
      }

      override saveVideo(_input: SaveVideoAttachment): Promise<VideoAttachmentRef> {
        throw new Error('unreachable: admission refuses before save')
      }

      override readVideo(_ref: VideoAttachmentRef): Promise<StoredVideoAttachment> {
        throw new Error('unreachable in this test')
      }
    }
    const ctx = await setup({ attachments: false })
    await ctx.plugin(MatroskaOnlyStore)
    const result = await readVideo(ctx, { file_path: 'clip.mp4' }, agentOn('video-model'))
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('video/mp4 videos are not accepted by this deployment')
  })
})

describe('video admission failures', () => {
  it('explains how to repair a non-video payload under a video extension', async () => {
    await writeFile(join(dir, 'wrong.mp4'), PNG_1X1)
    const ctx = await setup()
    const result = await readVideo(ctx, { file_path: 'wrong.mp4' }, agentOn('video-model'))
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('the .mp4 extension declares video/mp4')
    expect(text(result)).toContain('rename the file to match its actual container if it is MP4/MKV/MOV, or convert it to one of those containers')
  })

  it('explains a container mismatch between extension and bytes', async () => {
    await writeFile(join(dir, 'labeled.mp4'), MKV)
    const ctx = await setup()
    const result = await readVideo(ctx, { file_path: 'labeled.mp4' }, agentOn('video-model'))
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('the .mp4 extension declares video/mp4')
  })

  it('fails with FS_TOO_LARGE before reading a file past maxVideoBytes', async () => {
    await writeFile(join(dir, 'clip.mp4'), MP4)
    const ctx = await setup({ storeConfig: { maxVideoBytes: MP4.length - 1 } })
    const result = await readVideo(ctx, { file_path: 'clip.mp4' }, agentOn('video-model'))
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('exceeds')
  })

  it('honors the tighter per-message aggregate byte bound', async () => {
    await writeFile(join(dir, 'clip.mp4'), MP4)
    const ctx = await setup({ storeConfig: { maxMessageVideoBytes: MP4.length - 1 } })
    const result = await readVideo(ctx, { file_path: 'clip.mp4' }, agentOn('video-model'))
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('exceeds')
  })

  it('passes storage faults and non-attachment failures through unchanged', async () => {
    /** Store whose commit fails with a configurable error; admission itself passes. */
    class FailingStore extends AttachmentStore {
      static failure: unknown
      readonly imageLimits: ImageAttachmentLimits = Object.freeze({
        maxImageBytes: 1024,
        maxImagesPerMessage: 1,
        maxMessageImageBytes: 1024,
        maxImagePixels: 100,
        maxImageDimension: 2000,
        mediaTypes: Object.freeze([] as const),
      })

      override readonly videoLimits: VideoAttachmentLimits = Object.freeze({
        maxVideoBytes: 1024,
        maxVideosPerMessage: 1,
        maxMessageVideoBytes: 1024,
        mediaTypes: Object.freeze(['video/mp4', 'video/x-matroska', 'video/quicktime'] as const),
      })

      validateImage(_input: SaveImageAttachment): Promise<void> {
        throw new Error('unreachable: image admission never runs in this test')
      }

      saveImage(_input: SaveImageAttachment): Promise<ImageAttachmentRef> {
        throw new Error('unreachable: image admission never runs in this test')
      }

      readImage(_ref: ImageAttachmentRef): Promise<StoredImageAttachment> {
        throw new Error('unreachable: image admission never runs in this test')
      }

      override validateVideo(_input: SaveVideoAttachment): Promise<void> {
        return Promise.resolve()
      }

      override async saveVideo(_input: SaveVideoAttachment): Promise<VideoAttachmentRef> {
        throw FailingStore.failure
      }

      override readVideo(_ref: VideoAttachmentRef): Promise<StoredVideoAttachment> {
        throw new Error('unreachable in this test')
      }
    }
    await writeFile(join(dir, 'clip.mp4'), MP4)
    const ctx = await setup({ attachments: false })
    await ctx.plugin(FailingStore)

    FailingStore.failure = new AttachmentError('Unable to persist video attachment.', 'ATTACHMENT_WRITE_FAILED')
    const storageFault = await readVideo(ctx, { file_path: 'clip.mp4' }, agentOn('video-model'))
    expect(storageFault.isError).toBe(true)
    expect(text(storageFault)).toContain('Unable to persist video attachment.')

    FailingStore.failure = new AttachmentError('Video exceeds the configured byte limit.', 'VIDEO_TOO_LARGE')
    const overBudget = await readVideo(ctx, { file_path: 'clip.mp4' }, agentOn('video-model'))
    expect(overBudget.isError).toBe(true)
    expect(text(overBudget)).toContain(`cannot read "${join(dir, 'clip.mp4')}": the video cannot be stored within the deployment's byte limits; compress the video and read the smaller file`)

    FailingStore.failure = new Error('unrelated infrastructure failure')
    const unrelated = await readVideo(ctx, { file_path: 'clip.mp4' }, agentOn('video-model'))
    expect(unrelated.isError).toBe(true)
    expect(text(unrelated)).toContain('unrelated infrastructure failure')
  })

  it('reports a missing video file and a directory target through the fs vocabulary', async () => {
    await mkdir(join(dir, 'folder.mp4'))
    const ctx = await setup()
    const observed: { path: string; kind: string }[] = []
    ctx.on('fs/observed', (target, observation) => void observed.push({ path: target.displayPath, kind: observation.kind }))
    const missing = await readVideo(ctx, { file_path: 'absent.mp4' }, agentOn('video-model'))
    expect(missing.isError).toBe(true)
    expect(text(missing)).toContain('not found')
    expect(observed).toEqual([{ path: join(dir, 'absent.mp4'), kind: 'absent' }])

    const directory = await readVideo(ctx, { file_path: 'folder.mp4' }, agentOn('video-model'))
    expect(directory.isError).toBe(true)
    expect(text(directory)).toContain('not a regular file')
  })

  it('omits the display name when the store returns a reference without one', async () => {
    /** Store echoing a fixed nameless reference; deployments may strip names entirely. */
    class NamelessStore extends AttachmentStore {
      readonly imageLimits: ImageAttachmentLimits = Object.freeze({
        maxImageBytes: 1024,
        maxImagesPerMessage: 1,
        maxMessageImageBytes: 1024,
        maxImagePixels: 100,
        maxImageDimension: 2000,
        mediaTypes: Object.freeze([] as const),
      })

      override readonly videoLimits: VideoAttachmentLimits = Object.freeze({
        maxVideoBytes: 1024,
        maxVideosPerMessage: 1,
        maxMessageVideoBytes: 1024,
        mediaTypes: Object.freeze(['video/mp4', 'video/x-matroska', 'video/quicktime'] as const),
      })

      validateImage(_input: SaveImageAttachment): Promise<void> {
        throw new Error('unreachable: image admission never runs in this test')
      }

      saveImage(_input: SaveImageAttachment): Promise<ImageAttachmentRef> {
        throw new Error('unreachable: image admission never runs in this test')
      }

      readImage(_ref: ImageAttachmentRef): Promise<StoredImageAttachment> {
        throw new Error('unreachable: image admission never runs in this test')
      }

      override validateVideo(_input: SaveVideoAttachment): Promise<void> {
        return Promise.resolve()
      }

      override async saveVideo(input: SaveVideoAttachment): Promise<VideoAttachmentRef> {
        return { attachmentId: AttachmentId('sha256:feed'), mediaType: input.mediaType, bytes: input.data.length }
      }

      override readVideo(_ref: VideoAttachmentRef): Promise<StoredVideoAttachment> {
        throw new Error('unreachable in this test')
      }
    }
    await writeFile(join(dir, 'clip.mp4'), MP4)
    const ctx = await setup({ attachments: false })
    await ctx.plugin(NamelessStore)
    const result = await readVideo(ctx, { file_path: 'clip.mp4' }, agentOn('video-model'))
    expect(result.isError).toBe(false)
    const video = result.content[1] as { attachment: VideoAttachmentRef }
    expect(video.attachment.name).toBeUndefined()
  })
})

describe('registration surface', () => {
  it('withdraws read_video when the tool-fs fiber or the attachment store is disposed (HMR safety)', async () => {
    const ctx = new Context()
    provideWorkingDirectoryFixture(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime, { mode: 'native' })
    await ctx.plugin(LocalFileSystem, { cwd: dir })
    await ctx.plugin(FsPolicy)
    const attachmentsFiber = await ctx.plugin(LocalAttachmentStore, { dshHome: home })
    const toolFsFiber = await ctx.plugin(ToolFs)
    const names = () => ctx.tools.schemas().map(schema => schema.name).sort()
    expect(names()).toEqual(['edit', 'read', 'read_image', 'read_video', 'write'])

    // Disposing only the attachment store tears down the scoped inject fiber:
    // read_video withdraws while the unconditional tools stay registered.
    await attachmentsFiber.dispose()
    expect(names()).toEqual(['edit', 'read', 'write'])

    // Remounting the store restores the conditional registration.
    const remounted = await ctx.plugin(LocalAttachmentStore, { dshHome: home })
    expect(names()).toEqual(['edit', 'read', 'read_image', 'read_video', 'write'])

    // Disposing the whole plugin withdraws every tool, read_video included.
    await toolFsFiber.dispose()
    expect(names()).toEqual([])
    await remounted.dispose()
  })

  it('declares read_video parallel-safe and presents a read-family card', async () => {
    const ctx = await setup()
    expect(ctx.tools.executionMode({
      signal: testToolSignal, callId: ToolCallId('vid-parallel'), name: 'read_video', arguments: { file_path: 'a.mp4' },
    })).toEqual({ kind: 'parallel' })
    expect(ctx.tools.get('read_video')?.presentCall?.({ file_path: 'shot.mp4' })).toEqual({
      card: 'generic',
      title: 'Read video shot.mp4',
      kind: 'read',
      locations: [{ path: 'shot.mp4' }],
    })
  })
})
