import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { apply, renderQueue } from '../todo-inject.mjs'

function queue(lines) {
  return ['Current todo queue:', ...lines].join('\n')
}

describe('renderQueue', () => {
  it('returns empty string when in_progress, pending, and blocked are all empty', () => {
    assert.equal(renderQueue([]), '')
    assert.equal(renderQueue(undefined), '')
    assert.equal(renderQueue(null), '')
    assert.equal(renderQueue([{ content: 'done', status: 'completed' }]), '')
  })

  it('renders pending joined with arrows and blocked as (none)', () => {
    assert.equal(
      renderQueue([
        { content: 'first', status: 'pending' },
        { content: 'second', status: 'pending' },
      ]),
      queue([
        '- in_progress: (none)',
        '- pending: first → second',
        '- blocked: (none)',
        '- completed: 0',
      ]),
    )
  })

  it('classifies blocked from content even when status is pending or in_progress', () => {
    const text = renderQueue([
      { content: 'landed work', status: 'in_progress' },
      { content: 'wait on review blocked', status: 'pending' },
      { content: '阻塞: missing token', status: 'in_progress' },
      { content: 'blocked: sandbox', status: 'pending' },
      { content: 'finished', status: 'completed' },
    ])
    assert.equal(
      text,
      queue([
        '- in_progress: landed work',
        '- pending: (none)',
        '- blocked: wait on review blocked | 阻塞: missing token | blocked: sandbox',
        '- completed: 1',
      ]),
    )
  })

  it('still renders when only blocked items remain', () => {
    const text = renderQueue([
      { content: 'blocked: cannot proceed', status: 'pending' },
      { content: 'done', status: 'completed' },
    ])
    assert.equal(
      text,
      queue([
        '- in_progress: (none)',
        '- pending: (none)',
        '- blocked: blocked: cannot proceed',
        '- completed: 1',
      ]),
    )
  })

  it('does not reclassify completed items whose content mentions blocked', () => {
    const text = renderQueue([
      { content: 'was blocked then fixed', status: 'completed' },
      { content: 'next', status: 'pending' },
    ])
    assert.equal(
      text,
      queue([
        '- in_progress: (none)',
        '- pending: next',
        '- blocked: (none)',
        '- completed: 1',
      ]),
    )
  })
})

function installTodoInject() {
  const ons = []
  let contextCalls = 0
  apply({
    systemPrompt: {
      context() {
        contextCalls += 1
      },
    },
    on(event, handler, opts) {
      ons.push({ event, handler, opts })
    },
    get() {
      return undefined
    },
  })
  return {
    contextCalls,
    preStep: ons.find((row) => row.event === 'agent/pre-step'),
  }
}

describe('todo-inject apply', () => {
  it('does not write the queue into systemPrompt.context', () => {
    const installed = installTodoInject()
    assert.equal(installed.contextCalls, 0)
    assert.ok(installed.preStep)
    assert.equal(installed.preStep.opts.prepend, true)
  })

  it('injects the queue on pre-step 1 and skips when unchanged or empty', async () => {
    const { preStep } = installTodoInject()
    const todos = [{ content: 'land this', status: 'in_progress' }]
    const agent = {
      session: {
        events: [{ type: 'todo/write', data: { todos } }],
      },
    }
    const decision = { kind: 'enter', messages: [{ role: 'user', content: 'hi' }] }
    const out = await preStep.handler({ agent, step: 1 }, async () => decision)
    const injected = out.messages[0]
    assert.equal(injected.source.kind, 'plugin')
    assert.equal(injected.source.plugin, 'dsh-grok-code-todo-inject')
    assert.match(injected.content[0].text, /Current todo queue/)
    assert.match(injected.content[0].text, /land this/)
    assert.equal(out.messages[1].content, 'hi')

    agent.session.events.push({
      type: 'user/message',
      data: { source: injected.source, content: injected.content },
    })
    const again = await preStep.handler({ agent, step: 1 }, async () => decision)
    assert.equal(again.messages[0].content, 'hi')

    const later = await preStep.handler({ agent, step: 2 }, async () => decision)
    assert.equal(later.messages[0].content, 'hi')

    const emptyAgent = {
      session: {
        events: [{ type: 'todo/write', data: { todos: [{ content: 'done', status: 'completed' }] } }],
      },
    }
    const empty = await preStep.handler({ agent: emptyAgent, step: 1 }, async () => decision)
    assert.equal(empty.messages[0].content, 'hi')
  })
})
