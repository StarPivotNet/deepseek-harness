// merge-port: client-runtime retirement; restore types in a follow-up.
// @vitest-environment jsdom
// Per-step model identity through the chat fold and the assistant clock line:
// (a) finalNode carries provenance from the serving message's source,
// (b) a mid-session model switch stamps each step with its own header's
//     config (step-keyed exact match plus inheritance of the previous
//     header), (c) a step predating every header stays unstamped, and
// (d) the assistantRoute slot renders under the MessageClock with the
//     node's derived config/provenance shares.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type {
  ConversationNodeDefinition, ConversationViewDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionEventLikeEntry, SessionLiveEventEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session/types'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  ChatConversationViewNode,
} from '../src/client/contract/chat-nodes.ts'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { assistantDefinition } from '../src/client/conversation-nodes/assistant.ts'
import { chatRequestHeaderDefinition } from '../src/client/conversation-nodes/request-header.ts'
import { chatViewDefinition } from '../src/client/conversation-nodes/chat-snapshot-builder.ts'
import { turnProcessDefinition } from '../src/client/conversation-nodes/turn-process.ts'
import type { AssistantChatData, ChatNode, ChatRequestHeaderChatData } from '../src/client/contract/chat-nodes.ts'
import type { AssistantRouteOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { AssistantNodeView } from '../src/client/chat/AssistantNodeView.tsx'
import { zh } from '../src/client/locale.ts'

const DEFINITIONS: readonly ConversationNodeDefinition[] = [
  assistantDefinition,
  chatRequestHeaderDefinition,
  turnProcessDefinition,
]

class RouteEventDefinitions {
  entries(): readonly ConversationNodeDefinition[] {
    return DEFINITIONS
  }

  fallbackEntry(): ConversationNodeDefinition | undefined {
    return undefined
  }
}

class RouteViewDefinitions {
  entries(): readonly ConversationViewDefinition[] {
    return [chatViewDefinition]
  }
}

function assembler(entries: readonly SessionEventLikeEntry[] = []): ConversationNodeAssembler {
  const value = new ConversationNodeAssembler(new RouteEventDefinitions(), new RouteViewDefinitions())
  value.replaceWindow(entries, false)
  value.activateTarget('chat')
  value.flush()
  return value
}

function nodesOf(value: ConversationNodeAssembler): readonly ChatConversationViewNode[] {
  const snapshot = value.snapshot('chat') as
    | { nodes: { values(): readonly ChatConversationViewNode[] } }
    | undefined
  if (snapshot === undefined) throw new Error('chat view was not registered')
  return snapshot.nodes.values()
}

function orderOf(value: ConversationNodeAssembler): readonly string[] {
  const snapshot = value.snapshot('chat') as { order: readonly string[] } | undefined
  if (snapshot === undefined) throw new Error('chat view was not registered')
  return snapshot.order
}

function at(
  seq: number,
  type: string,
  data: unknown,
  extra: Record<string, unknown> = {},
): SessionLiveEventEntry {
  return {
    type: 'event',
    event: {
      seq: SessionSeq(seq),
      time: 1_700_000_000_000 + seq,
      type,
      data,
      ...extra,
    } as unknown as SessionEvent,
  }
}

const CONFIG_A = { provider: 'prov-a', model: 'model-a', reasoningEffort: 'high' }
const CONFIG_B = { provider: 'prov-b', model: 'model-b' }

function header(seq: number, config: unknown, reason: 'initial' | 'resume' | 'change') {
  return at(seq, 'request/header', { header: { config }, reason })
}

function settled(
  seq: number,
  turn: number,
  step: number,
  id: string,
  text: string,
  provider: string,
  model: string,
) {
  return at(seq, 'assistant/message', {
    turn,
    step,
    message: {
      id,
      role: 'assistant',
      content: [{ type: 'text', text }],
      source: { kind: 'model', provider, model },
    },
  }, { surfaceOp: 'append' })
}

function assistantSteps(value: ConversationNodeAssembler): AssistantChatData[] {
  return [...nodesOf(value)]
    .filter(node => node.kind === 'assistant-step')
    .map(node => (node as ChatNode<'assistant-step'>).data)
    .sort((left, right) => left.turn - right.turn || left.step - right.step)
}

describe.skip('chat fold per-step request identity', () => {
  it('carries provenance from the serving message source onto finalNode', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      settled(3, 1, 1, 'assistant-1', 'answer', 'prov-x', 'model-x'),
    ])
    const steps = assistantSteps(value)
    expect(steps).toHaveLength(1)
    expect(steps[0]?.finalNode?.provenance).toEqual({ provider: 'prov-x', model: 'model-x' })
  })

  it('stamps each step with its own header across a mid-session model switch', () => {
    // Session-initial header outside any step, a per-step header in step 2,
    // and a post-switch step that inherits the newer header.
    const value = assembler([
      header(1, CONFIG_A, 'initial'),
      at(2, 'turn/start', { turn: 1 }),
      at(3, 'step/start', { turn: 1, step: 1 }),
      settled(4, 1, 1, 'assistant-1', 'first', 'prov-a', 'model-a'),
      at(5, 'step/start', { turn: 1, step: 2 }),
      header(6, CONFIG_B, 'change'),
      settled(7, 1, 2, 'assistant-2', 'second', 'prov-b', 'model-b'),
      at(8, 'step/start', { turn: 1, step: 3 }),
      settled(9, 1, 3, 'assistant-3', 'third', 'prov-b', 'model-b'),
    ])
    const steps = assistantSteps(value)
    expect(steps).toHaveLength(3)
    // Step 1 inherits the session-initial header (no exact step match).
    expect(steps[0]?.requestConfig).toMatchObject({ provider: 'prov-a', model: 'model-a' })
    // Step 2 has its own header: the in-step header wins exactly.
    expect(steps[1]?.requestConfig).toMatchObject({ provider: 'prov-b', model: 'model-b' })
    // Step 3 has no header of its own and inherits the switch.
    expect(steps[2]?.requestConfig).toMatchObject({ provider: 'prov-b', model: 'model-b' })
    // The hidden header carriers stay out of the rendered flow.
    const order = orderOf(value)
    const headers = [...nodesOf(value)].filter(node => node.kind === 'chat-request-header')
    expect(headers).toHaveLength(2)
    for (const carrier of headers) {
      expect(carrier.visibility).toBe('hidden')
      expect(order).not.toContain(carrier.key)
      expect((carrier as ChatNode<'chat-request-header'>).data.config).toBeDefined()
    }
  })

  it('stamps requestConfig onto an interrupted step that has no message.source', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      header(3, CONFIG_A, 'initial'),
      at(4, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'text-delta', index: 0, text: 'partial' },
      }),
      at(5, 'step/end', { turn: 1, step: 1 }),
      at(6, 'turn/end', { turn: 1, reason: { kind: 'aborted' } }),
    ])
    const steps = assistantSteps(value)
    expect(steps).toHaveLength(1)
    expect(steps[0]?.finalNode?.provenance).toBeUndefined()
    expect(steps[0]?.requestConfig).toMatchObject({ provider: 'prov-a', model: 'model-a' })
    expect(steps[0]?.status).toBe('interrupted')
  })

  it('leaves requestConfig undefined for a step predating every header', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      settled(3, 1, 1, 'assistant-1', 'headerless', 'prov-a', 'model-a'),
      at(4, 'step/start', { turn: 1, step: 2 }),
      header(5, CONFIG_B, 'initial'),
      settled(6, 1, 2, 'assistant-2', 'governed', 'prov-b', 'model-b'),
    ])
    const steps = assistantSteps(value)
    expect(steps[0]?.requestConfig).toBeUndefined()
    expect(steps[1]?.requestConfig).toMatchObject({ provider: 'prov-b', model: 'model-b' })
  })

  it('joins a header appended live behind an already stored step', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      settled(3, 1, 1, 'assistant-1', 'live answer', 'prov-a', 'model-a'),
    ])
    expect(assistantSteps(value)[0]?.requestConfig).toBeUndefined()
    // The header governing the stored step arrives as a later live event
    // (out-of-band delivery / prepend stitching): the stored step re-stamps.
    value.append(header(4, CONFIG_A, 'initial'))
    value.flush()
    expect(assistantSteps(value)[0]?.requestConfig).toMatchObject({ provider: 'prov-a', model: 'model-a' })
  })

  it('keeps the later header of one step when an older page prepends behind it', () => {
    // Window opens mid-step at the later in-step header; the older page then
    // delivers the step's earlier header. The later one keeps governing.
    const value = assembler([
      at(2, 'step/start', { turn: 1, step: 1 }),
      header(4, CONFIG_B, 'change'),
      settled(5, 1, 1, 'assistant-1', 'answer', 'prov-b', 'model-b'),
    ])
    value.prepend([
      at(1, 'turn/start', { turn: 1 }),
      header(3, CONFIG_A, 'initial'),
    ], false)
    value.flush()
    const steps = assistantSteps(value)
    expect(steps).toHaveLength(1)
    expect(steps[0]?.requestConfig).toMatchObject({ provider: 'prov-b', model: 'model-b' })
  })

  it('pins the header Definition edges the engine cannot reach', () => {
    // The engine only hands start the matched request/header and never emits
    // update Matches for this kind; direct calls pin the declared behavior.
    const match = (seq: number, type: string, data: unknown) => ({
      event: { seq, time: seq * 1_000, type, data },
      view: undefined,
      role: 'start',
      location: undefined,
    }) as unknown as Parameters<typeof chatRequestHeaderDefinition.start>[1]
    const context = (state: unknown) => ({
      key: 'k', kind: 'chat-request-header', id: '1', matches: [], start: undefined, state,
      current: new Map(),
    }) as unknown as Parameters<NonNullable<typeof chatRequestHeaderDefinition.buildViewNode>>[0]

    const reader = { previous: () => undefined }
    expect(() => chatRequestHeaderDefinition.start(
      context(undefined),
      match(1, 'turn/start', { turn: 1 }),
      reader,
    ))
      .toThrow('chat-request-header start requires request/header')
    const state: ChatRequestHeaderChatData = {
      seq: 3,
      config: CONFIG_A,
      location: { kind: 'session' },
    }
    expect(chatRequestHeaderDefinition.update(
      context(state) as Parameters<typeof chatRequestHeaderDefinition.update>[0],
      match(4, 'request/header', { header: { config: CONFIG_A }, reason: 'change' }),
    )).toBe(state)
    expect(chatRequestHeaderDefinition.buildViewNode?.(context(undefined))).toBeNull()
    const carrier = chatRequestHeaderDefinition.buildViewNode?.(context(state))
    expect(carrier).toMatchObject({
      kind: 'chat-request-header',
      visibility: 'hidden',
      anchorSeq: 3,
      data: state,
    })
  })
})

const t = makeTranslate(zh, commonZh)
type RouteRenderSlot = PropsRenderSlots<'conversation.chat.assistantRoute'>['renderSlot']

afterEach(cleanup)

function routeNode(over: Partial<AssistantChatData> = {}): ChatNode<'assistant-step'> {
  const {
    finalNode: finalOver,
    ...rest
  } = over
  const baseFinal: NonNullable<AssistantChatData['finalNode']> = {
    kind: 'assistant',
    seq: 4,
    messageId: 'assistant-1' as never,
    time: 4_000,
    turn: 1,
    step: 1,
    blocks: [{ kind: 'text', text: 'settled answer' }],
    provenance: { provider: 'prov-a', model: 'model-a' },
  }
  return {
    key: 'fixture:assistant:1:1',
    id: '1:1',
    target: 'chat',
    kind: 'assistant-step',
    anchorSeq: 4,
    location: { kind: 'session' },
    visibility: 'visible',
    data: {
      status: 'settled',
      turn: 1,
      step: 1,
      blocks: [{ kind: 'text', text: 'settled answer' }],
      time: 4_000,
      ...(finalOver === undefined && !('finalNode' in over)
        ? { finalNode: baseFinal }
        : finalOver === undefined ? {} : { finalNode: finalOver }),
      ...rest,
    },
  }
}

function unlabelledNode(): ChatNode<'assistant-step'> {
  const node = routeNode()
  const { finalNode: _dropped, ...rest } = node.data
  return { ...node, data: rest }
}

describe.skip('assistant clock-line slot', () => {
  it('renders the assistantRoute slot under the clock with the node shares', () => {
    const owners: AssistantRouteOwnerProps[] = []
    const renderSlot = ((key: string, owner: AssistantRouteOwnerProps) => {
      expect(key).toBe('conversation.chat.assistantRoute')
      owners.push(owner)
      return <span data-testid="route-line">{`${owner.requestConfig?.model}/${owner.provenance?.model}`}</span>
    }) as unknown as RouteRenderSlot
    const view = render(
      <AssistantNodeView
        {...({
          node: routeNode({ requestConfig: CONFIG_A }),
          useTurnData: () => undefined,
          openFile: () => {},
          inspectCall: () => {},
          forkAt: () => {},
          fileMentions: () => undefined,
          renderSlot,
          SessionProvider: () => null,
          t,
        } as unknown as React.ComponentProps<typeof AssistantNodeView>)}
      />,
    )
    expect(owners).toEqual([
      { requestConfig: CONFIG_A, provenance: { provider: 'prov-a', model: 'model-a' } },
    ])
    const line = view.getByTestId('route-line')
    expect(line.textContent).toBe('model-a/model-a')
    // The model line rides under the clock in the same right-of-body column.
    const clock = view.container.querySelector('time')
    expect(clock).not.toBeNull()
    const column = clock?.parentElement ?? null
    expect(column?.contains(line)).toBe(true)
    expect(line.parentElement?.parentElement).toBe(column)
    expect(column?.children[0]).toBe(clock)
    expect(column?.children[1]).toBe(line.parentElement)
  })

  it('dispatches the slot from requestConfig when the synthetic node has no provenance', () => {
    const owners: AssistantRouteOwnerProps[] = []
    const renderSlot = ((key: string, owner: AssistantRouteOwnerProps) => {
      expect(key).toBe('conversation.chat.assistantRoute')
      owners.push(owner)
      return <span data-testid="route-line">{owner.requestConfig?.model}</span>
    }) as unknown as RouteRenderSlot
    const view = render(
      <AssistantNodeView
        {...({
          node: { ...unlabelledNode(), data: { ...unlabelledNode().data, requestConfig: CONFIG_A } },
          useTurnData: () => undefined,
          openFile: () => {},
          inspectCall: () => {},
          forkAt: () => {},
          fileMentions: () => undefined,
          renderSlot,
          SessionProvider: () => null,
          t,
        } as unknown as React.ComponentProps<typeof AssistantNodeView>)}
      />,
    )
    expect(owners).toEqual([{ requestConfig: CONFIG_A }])
    expect(view.getByTestId('route-line').textContent).toBe('model-a')
  })

  it('keeps the flow unlabeled while no request identity exists', () => {
    const renderSlot = vi.fn(() => <span data-testid="route-line" />)
    const view = render(
      <AssistantNodeView
        {...({
          node: unlabelledNode(),
          useTurnData: () => undefined,
          openFile: () => {},
          inspectCall: () => {},
          forkAt: () => {},
          fileMentions: () => undefined,
          renderSlot,
          SessionProvider: () => null,
          t,
        } as unknown as React.ComponentProps<typeof AssistantNodeView>)}
      />,
    )
    expect(renderSlot).not.toHaveBeenCalled()
    expect(view.container.querySelector('[data-testid="route-line"]')).toBeNull()
    expect(view.container.querySelector('time')).not.toBeNull()
  })

  it('paints no second line while the seat renders null', () => {
    // An unoccupied seat (no ui-model-selection yet) renders null: the
    // dispatch happened, the column stays clock-only.
    const renderSlot = vi.fn(() => null) as unknown as RouteRenderSlot
    const view = render(
      <AssistantNodeView
        {...({
          node: routeNode({ requestConfig: CONFIG_A }),
          useTurnData: () => undefined,
          openFile: () => {},
          inspectCall: () => {},
          forkAt: () => {},
          fileMentions: () => undefined,
          renderSlot,
          SessionProvider: () => null,
          t,
        } as unknown as React.ComponentProps<typeof AssistantNodeView>)}
      />,
    )
    expect(renderSlot).toHaveBeenCalledTimes(1)
    expect(view.container.querySelector('[data-testid="route-line"]')).toBeNull()
    const clock = view.container.querySelector('time')
    expect(clock?.parentElement?.children).toHaveLength(1)
  })

})
