import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type { PendingSubmission } from '@deepseek-ai/dsh-api-session-controller/client'
import type { PropsRenderFactories, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { UserTextFacts } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { JsonBlock, StateDot, TextShimmer } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ChatNodeOwnerProps, ChatNodeViewProps, ChatViewSlotProps, UserContentAttachment, UserContentData, UserContentInput,
} from '../contract/slots.ts'
import type { ModelRetryNode, TurnErrorNode, UserMessageNode } from '../contract/snapshot.ts'
import { CompactionItem } from './CompactionItem.tsx'
import { ContextInjectionRow } from './ContextInjectionRow.tsx'
import { MessageIconActions } from './MessageIconActions.tsx'
import css from './MessageItem.module.css'

const EMPTY_TEXT_FACTS: Readonly<Partial<UserTextFacts>> = {}

type UserImage = Extract<UserMessageNode['content'][number], { type: 'image' }>
type UserFile = Extract<UserMessageNode['content'][number], { type: 'file' }>
type PresentedAttachment = UserContentAttachment | {
  readonly type: 'video'
  readonly previewUrl: string
  readonly name?: string
}

function contentParts(content: readonly unknown[]): {
  text: string
  attachments: PresentedAttachment[]
  rest: unknown[]
} {
  const texts: string[] = []
  const attachments: PresentedAttachment[] = []
  const rest: unknown[] = []
  for (const block of content) {
    const b = block as { type?: string; text?: string; attachment?: unknown }
    if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text)
    else if (b.type === 'image' && b.attachment !== undefined) {
      attachments.push({ type: 'image', image: { attachment: (b as UserImage).attachment } })
    }
    else if (b.type === 'file' && b.attachment !== undefined) {
      attachments.push({ type: 'file', file: (b as UserFile).attachment })
    }
    else rest.push(block)
  }
  return { text: texts.join(''), attachments, rest }
}

function retrySeconds(milliseconds: number): number {
  return Math.max(1, Math.ceil(milliseconds / 1_000))
}

interface RetryCountdown {
  deadline: number
  seconds: number
}

function failureMessage(
  message: string,
  code: unknown,
  t: ChatViewSlotProps['t'],
): string {
  if (code === 'ACCOUNT_SIGNED_OUT') return t('message.failure.accountSignedOut')
  if (code === 'INTERRUPTED') return t('message.failure.interrupted')
  if (code === 'ACCOUNT_SIGN_IN_REQUIRED') return t('message.failure.accountSignInRequired')
  if (code === 'QUOTA' || code === 'ACCOUNT_QUOTA') return t('message.failure.quota')
  return code === 'AUTH' ? t('message.failure.auth') : message
}

function ModelRetryItem({ node, active, t }: {
  node: ModelRetryNode
  active: boolean
  t: ChatViewSlotProps['t']
}) {
  // Anchor the host-scheduled delay to this browser's first render of the
  // retry node. Host event time and Date.now() may belong to different clocks.
  const deadline = useMemo(() => Date.now() + node.delayMs, [node.delayMs, node.seq])
  const scheduledSeconds = retrySeconds(node.delayMs)
  const maximum = node.mode === 'normal' ? node.maxRetries : '∞'
  const [countdown, setCountdown] = useState<RetryCountdown>(() => ({
    deadline,
    seconds: retrySeconds(deadline - Date.now()),
  }))
  const remainingSeconds = countdown.deadline === deadline
    ? countdown.seconds
    : retrySeconds(deadline - Date.now())

  useEffect(() => {
    if (!active) return
    const updateCountdown = (): number => {
      const next = retrySeconds(deadline - Date.now())
      setCountdown(current => (
        current.deadline === deadline && current.seconds === next
          ? current
          : { deadline, seconds: next }
      ))
      return next
    }
    if (updateCountdown() === 1) return
    const timer = window.setInterval(() => {
      if (updateCountdown() === 1) window.clearInterval(timer)
    }, 250)
    return () => { window.clearInterval(timer) }
  }, [active, deadline])

  const label = active
    ? t('message.retry.active')
    : node.retryState === 'cancelled'
      ? t('message.retry.cancelled')
      : node.retryState === 'started'
        ? t('message.retry.started')
        : t('message.retry.scheduled')
  const seconds = active ? remainingSeconds : scheduledSeconds

  return (
    <details className={css.retryRow} data-active={active || undefined}>
      <summary className={css.retrySummary}>
        <span className={css.retryText} role="status">
          <TextShimmer active={active}>
            {t('message.retry.status', { label, retry: node.retry, maximum, seconds })}
          </TextShimmer>
        </span>
      </summary>
      <div className={css.retryDetails}>
        <div>
          <span className={css.retryDetailLabel}>{t('message.retry.delay')}</span>
          {t('duration.milliseconds', { milliseconds: Math.round(node.delayMs) })}
        </div>
        <div>
          <span className={css.retryDetailLabel}>{t('message.retry.failure')}</span>
          {failureMessage(node.failure.message, node.failure.code, t)}
        </div>
      </div>
    </details>
  )
}

/** Persistent, turn-positioned feedback for a terminal failure. */
function TurnErrorItem({ node, t }: {
  node: TurnErrorNode
  t: ChatViewSlotProps['t']
}) {
  return (
    <div className={css.turnErrorRow} role="status">
      <StateDot state="error" className={css.turnErrorDot} />
      <div className={css.turnErrorCopy}>
        <span className={css.turnErrorTitle}>{node.code === 'ACCOUNT_SIGNED_OUT' || node.code === 'INTERRUPTED' ? t('message.taskStopped') : t('message.turnError')}</span>
        <span className={css.turnErrorMessage}>{failureMessage(node.message, node.code, t)}</span>
      </div>
      {node.code !== undefined && node.code !== 'INTERRUPTED' && <code className={css.turnErrorCode}>{node.code}</code>}
    </div>
  )
}

/** Persistent, turn-positioned notice for a turn ended at the output-token cap. */
function TurnMaxTokensItem({ t }: {
  t: ChatViewSlotProps['t']
}) {
  return (
    <div className={css.turnErrorRow} role="status">
      <StateDot state="warning" className={css.turnErrorDot} />
      <div className={css.turnErrorCopy}>
        <span className={css.maxTokensTitle}>{t('message.maxTokens')}</span>
        <span className={css.turnErrorMessage}>{t('message.maxTokens.hint')}</span>
      </div>
    </div>
  )
}

/**
 * A row the message-source seat decorates. A durable Chat node satisfies it;
 * pending and local-echo rows pass a source-less stand-in.
 */
interface DecoratedRow {
  readonly kind: 'user' | 'steering'
  readonly data: { readonly source: unknown }
}

/** Pending and local-echo rows carry no durable source for the seat to elect. */
const UNDECORATED_ROW: DecoratedRow = { kind: 'user', data: { source: null } }

/** Occupant used by rows that do not own the message-source seat. */
const NO_MESSAGE_SOURCE: PropsRenderSlots<'conversation.chat.user.before'>['renderSlotChain'] = () => null

/** Right-aligned bubble shared by user and steering rows. */
function UserStyleBubble({
  node, renderSlotChain, content, loadImage, renderFactorySlot, actions, pending = false, echo = false, batchStart = false,
  referenceLabels, skillNames, previewAttachments, facts: inputFacts = EMPTY_TEXT_FACTS, interactive = false, t,
  editing = false, draft = '', onDraftChange, onSaveEdit, onCancelEdit,
}: {
  content: readonly unknown[]
  renderFactorySlot: PropsRenderFactories['renderFactorySlot']
  /** Optional IconActions (or similar) below the bubble; receives the joined text. */
  actions?: (text: string) => ReactNode
  /** Row whose durable source the message-source seat elects above this bubble. */
  node: DecoratedRow
  /** Seat renderer; rows that do not own the seat pass {@link NO_MESSAGE_SOURCE}. */
  renderSlotChain: PropsRenderSlots<'conversation.chat.user.before'>['renderSlotChain']
  /** Whether this is the Host-authoritative pre-admission steering projection. */
  pending?: boolean
  /** Whether this is a local submission echo (invisible marker; the echo renders exactly like its durable replacement). */
  echo?: boolean
  /** Whether this admitted steering row starts its claim's batch and keeps the Turn tail slot above it. */
  batchStart?: boolean
  /** Exact session mention labels associated by the adjacent recall node. */
  referenceLabels?: readonly string[]
  /** Skill names the step's `skill-invocation` injections loaded for this message. */
  skillNames?: readonly string[]
  /** Local submission-echo attachments replacing the content-derived attachment sequence. */
  previewAttachments?: readonly PresentedAttachment[]
  /** Inputs used by text transforms, separate from row and rendering props. */
  facts?: Readonly<Partial<UserTextFacts>>
  t?: ChatViewSlotProps['t']
  /** Replace the projected text with an in-place editor. */
  editing?: boolean
  draft?: string
  onDraftChange?: (text: string) => void
  onSaveEdit?: () => void
  onCancelEdit?: () => void
} & Pick<ChatNodeOwnerProps, 'loadImage'> & Pick<UserContentInput, 'interactive'>): ReactNode {
  const parts = useMemo(() => contentParts(content), [content])
  const attachments = previewAttachments ?? parts.attachments
  const factoryAttachments = attachments.filter((attachment): attachment is UserContentAttachment => attachment.type !== 'video')
  const prepared = useMemo<UserContentData>(() => ({
    text: editing ? '' : parts.text,
    attachments: factoryAttachments,
    extraBlocks: parts.rest,
    ...(referenceLabels === undefined ? {} : { referenceLabels }),
  }), [editing, factoryAttachments, parts, referenceLabels])
  const facts = useMemo<Readonly<Partial<UserTextFacts>>>(() => ({
    ...inputFacts,
    ...(referenceLabels === undefined ? {} : { sessionLabels: referenceLabels }),
    ...(skillNames === undefined ? {} : { skillNames }),
  }), [inputFacts, referenceLabels, skillNames])
  const onEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancelEdit?.()
      return
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
      event.preventDefault()
      onSaveEdit?.()
    }
  }
  return (
    <div
      className={css.userRow}
      data-pending-steering={pending || undefined}
      data-submission-echo={echo || undefined}
      data-chat-steering-batch={batchStart ? 'start' : undefined}
    >
      {renderSlotChain('conversation.chat.user.before', { source: node.data.source, kind: node.kind }, { fallback: null })}
      <div className={css.userStack}>
        {renderFactorySlot('conversation.chat.user.content', {
          content: prepared,
          loadImage,
          facts,
          interactive: interactive && !editing,
        })}
        {attachments.some(attachment => attachment.type === 'video') && (
          <div className={css.attachmentRow}>
            {attachments.map((attachment, index) => attachment.type === 'video' ? (
              <video
                key={`video:${index}`}
                className={css.fileCard}
                src={attachment.previewUrl}
                controls
                preload="metadata"
                aria-label={attachment.name}
              />
            ) : null)}
          </div>
        )}
        {editing && t !== undefined && (
          <textarea
            className={css.editor}
            aria-label={t('message.edit')}
            value={draft}
            onChange={event => onDraftChange?.(event.currentTarget.value)}
            onKeyDown={onEditorKeyDown}
            autoFocus
          />
        )}
      </div>
      {actions?.(editing ? draft : prepared.text)}
    </div>
  )
}

/**
 * Render one Host-authoritative pending steering item with the same visual
 * language as its eventual durable transcript node.
 * @param props - pending content, authorized image loader, and Factory/locale seats.
 * @returns the pending steering bubble.
 */
export function PendingSteeringBubble({ content, loadImage, renderFactorySlot, t }: {
  content: readonly unknown[]
  renderFactorySlot: PropsRenderFactories['renderFactorySlot']
  t: ChatViewSlotProps['t']
} & Pick<ChatNodeOwnerProps, 'loadImage'>): ReactNode {
  return (
    <UserStyleBubble
      node={UNDECORATED_ROW}
      renderSlotChain={NO_MESSAGE_SOURCE}
      content={content}
      renderFactorySlot={renderFactorySlot}
      loadImage={loadImage}
      pending
      actions={text => (
        <MessageIconActions
          text={text}
          clock="start"
          className={css.actions}
          t={t}
        />
      )}
    />
  )
}

/**
 * Render one local transcript or steering submission echo with the same
 * visual language and surface marker as the Host occurrence that replaces
 * it: draft text plus object-URL previews, visible from the submit click
 * until the durable `user/message` or steering occurrence renders.
 * @param props - the pending submission, authorized image loader, and render seats.
 * @returns the echoed user bubble.
 */
export function PendingSubmissionBubble({ submission, loadImage, renderFactorySlot, t }: {
  submission: PendingSubmission
  renderFactorySlot: PropsRenderFactories['renderFactorySlot']
  t: ChatViewSlotProps['t']
} & Pick<ChatNodeOwnerProps, 'loadImage'>): ReactNode {
  const content = useMemo(
    () => (submission.text === '' ? [] : [{ type: 'text', text: submission.text }]),
    [submission.text],
  )
  const previewAttachments = useMemo<readonly PresentedAttachment[]>(
    () => submission.attachments.map((attachment) => {
      if (attachment.type === 'image') {
        return {
          type: 'image' as const,
          image: {
            preview: {
              url: attachment.value.previewUrl,
              ...(attachment.value.name === undefined ? {} : { name: attachment.value.name }),
              ...(attachment.value.width === undefined ? {} : { width: attachment.value.width }),
              ...(attachment.value.height === undefined ? {} : { height: attachment.value.height }),
            },
          },
        }
      }
      if (attachment.type === 'video') {
        return {
          type: 'video' as const,
          previewUrl: attachment.value.previewUrl,
          ...(attachment.value.name === undefined ? {} : { name: attachment.value.name }),
        }
      }
      return { type: 'file' as const, file: attachment.value }
    }),
    [submission.attachments],
  )
  return (
    <UserStyleBubble
      node={UNDECORATED_ROW}
      renderSlotChain={NO_MESSAGE_SOURCE}
      content={content}
      previewAttachments={previewAttachments}
      renderFactorySlot={renderFactorySlot}
      loadImage={loadImage}
      pending={submission.placement === 'steering'}
      echo
      actions={text => (
        <MessageIconActions
          text={text}
          time={submission.time}
          clock="start"
          className={css.actions}
          t={t}
        />
      )}
    />
  )
}

/**
 * Official user and admitted-steering keyed Chat renderer.
 *
 * Renders the durable-message chain seat directly above the bubble. The seat is
 * declared by the `user` registration alone, so a steering row renders the same
 * bubble without asking for it.
 */
export const UserMessageNodeView = memo(function UserMessageNodeView({
  node, renderFactorySlot, loadImage, renderSlotChain, rewriteAt, t,
}: ChatNodeViewProps<'user' | 'steering'> & {
  /** Bound by the `user` keyed registration, the only entry that declares the seat. */
  renderSlotChain: PropsRenderSlots<'conversation.chat.user.before'>['renderSlotChain']
}) {
  const data = node.data
  const editable = node.kind === 'user' && rewriteAt !== undefined
  const originalText = contentParts(data.content).text
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(originalText)
  const beginEdit = useCallback(() => {
    setDraft(originalText)
    setEditing(true)
  }, [originalText])
  const cancelEdit = useCallback(() => {
    setDraft(originalText)
    setEditing(false)
  }, [originalText])
  const saveEdit = useCallback(() => {
    const next = draft.trim()
    if (next === '' || rewriteAt === undefined) return
    setEditing(false)
    rewriteAt(data.seq, next)
  }, [data.seq, draft, rewriteAt])
  return (
    <UserStyleBubble
      node={node}
      renderSlotChain={renderSlotChain}
      content={data.content}
      interactive
      renderFactorySlot={renderFactorySlot}
      loadImage={loadImage}
      batchStart={node.kind === 'steering' && node.data.batchStart === true}
      {...data.referenceLabels === undefined ? {} : { referenceLabels: data.referenceLabels }}
      {...data.skillNames === undefined ? {} : { skillNames: data.skillNames }}
      t={t}
      editing={editing}
      draft={draft}
      onDraftChange={setDraft}
      onSaveEdit={saveEdit}
      onCancelEdit={cancelEdit}
      actions={text => (
        <MessageIconActions
          text={text}
          time={data.time}
          clock="start"
          className={css.actions}
          onEdit={editing || !editable ? undefined : beginEdit}
          onSaveEdit={editing ? saveEdit : undefined}
          onCancelEdit={editing ? cancelEdit : undefined}
          saveDisabled={draft.trim() === ''}
          t={t}
        />
      )}
    />
  )
})

/** Injected-context keyed Chat renderer. */
export const ContextMessageNodeView = memo(function ContextMessageNodeView({ node, t }: ChatNodeViewProps<'context'>) {
  const data = node.data
  return (
    <ContextInjectionRow
      content={data.content}
      source={data.source}
      producer={data.producer}
      form={data.form}
      t={t}
    />
  )
})

/** Automatic compaction keyed Chat renderer. */
export const CompactionNodeView = memo(function CompactionNodeView({ node, t }: ChatNodeViewProps<'compaction'>) {
  return <CompactionItem node={node.data} t={t} />
})

/** Correlated retry-chain keyed Chat renderer. */
export const RetryNodeView = memo(function RetryNodeView({ node, t }: ChatNodeViewProps<'model-retry'>) {
  const data = node.data
  return <ModelRetryItem node={data.current} active={data.current.retryState === 'scheduled'} t={t} />
})

/** Terminal turn-error keyed Chat renderer. */
export const TurnErrorNodeView = memo(function TurnErrorNodeView({ node, t }: ChatNodeViewProps<'turn-error'>) {
  return <TurnErrorItem node={node.data} t={t} />
})

/** Max-tokens turn-end notice keyed Chat renderer. */
export const TurnMaxTokensNodeView = memo(function TurnMaxTokensNodeView({ t }: ChatNodeViewProps<'turn-max-tokens'>) {
  return <TurnMaxTokensItem t={t} />
})

/** Explicit unknown-surface keyed Chat renderer. */
export const UnknownNodeView = memo(function UnknownNodeView({ node, t }: ChatNodeViewProps<'unknown'>) {
  const data = node.data
  return (
    <div className={css.contextRow}>
      <JsonBlock
        label={t('message.unknownSurface', { type: data.type })}
        payload={data.data}
        truncatedLabel={total => t('json.truncated', { total })}
      />
    </div>
  )
})
