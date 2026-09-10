import { describe, expect, it } from 'vitest'
import { SessionFormatEventCollector } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatEvent, SessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'
import { assertReleasedPayloadSemantics } from '@deepseek-ai/dsh-session-format-v0-to-v1'
import { restoreReleasedV3Artifact, sessionFormatV2ToV3 } from '../src/index.ts'
import { assertEvent } from '../src/payload.ts'

const payloads: Record<string, SessionFormatJsonObject> = {
  'team/member': { member: { id: 'child', name: 'worker', description: '', provider: 'spawn', context: 'fresh', phase: 'active' } },
  'team/task': { task: { id: 'task-1', revision: 1, subject: 'audit', description: '', status: 'pending', blockedBy: [], writeScopes: [] } },
  'team/message/queued': { message: { id: 'message-1', senderId: 'lead', senderName: 'lead', targetId: 'child', content: [{ type: 'text', text: 'audit' }] } },
  'team/message/delivered': { messageId: 'message-1', targetId: 'child' },
}
function event(type: string, data: SessionFormatJsonObject): SessionFormatEvent {
  return { type, seq: 0, time: 1, data: { version: 2, teamId: 'lead', ...data } }
}

describe('released Session v2 Team payloads', () => {
  it('preserves all four Team v2 payloads through migration and restoration', () => {
    const sourceHeader = { version: 2, id: 'lead', createdAt: 1, isSeeded: false, delegationDepth: 0 }
    const targetHeader = sessionFormatV2ToV3.migrateHeader(sourceHeader)
    const stage = sessionFormatV2ToV3.createStage({
      sourceHeader, targetHeader, sourceInheritedEventCount: 0, sourceKind: 'decoded',
    })
    const collector = new SessionFormatEventCollector()
    const events = Object.entries(payloads).map(([type, data], seq) => ({ ...event(type, data), seq }))
    const original = structuredClone(events)
    for (const value of events) stage.transformEvent(value, collector)
    const restored = restoreReleasedV3Artifact(
      { header: targetHeader, inheritedEventCount: stage.finish(collector), events: collector.values },
      new Set(Object.keys(payloads)),
    )
    expect(restored.events).toEqual(original)
    expect(events).toEqual(original)
  })

  it.each(Object.keys(payloads))('validates the independent Team payload version for %s', (type) => {
    for (const version of [0, 1, 2]) expect(() => assertReleasedPayloadSemantics(event(type, payloads[type]!), version)).not.toThrow()
    for (const version of [0, 3, '2']) expect(() => assertEvent(event(type, { ...payloads[type], version }), 2)).toThrow(/version/)
    expect(() => assertEvent(event(type, { ...payloads[type], teamId: '' }), 2)).toThrow(/teamId/)
  })

  it('checks delivery only in the Team v1 mailbox schema', () => {
    const message = payloads['team/message/queued']!['message'] as SessionFormatJsonObject
    for (const delivery of ['quiet', 'wakeup']) {
      expect(() => assertEvent(event('team/message/queued', { version: 1, message: { ...message, delivery } }), 2)).not.toThrow()
      expect(() => assertEvent(event('team/message/queued', { message: { ...message, delivery } }), 2)).toThrow(/delivery/)
    }
    expect(() => assertEvent(event('team/message/queued', { version: 1, message }), 2)).toThrow(/delivery/)
    expect(() => assertEvent(event('team/message/queued', { version: 1, message: { ...message, delivery: 'invalid' } }), 2)).toThrow(/delivery/)
    expect(() => assertEvent(event('team/message/queued', { message: { ...message, content: [{ type: 'text', text: 3 }] } }), 2)).toThrow(/text/)
  })
})
