import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { emptyEditDenial, shouldObserve } from '../tool-observe.mjs'

function call(name, args) {
  return { type: 'tool/call', data: { name, arguments: args } }
}

function execWith(events, name, args) {
  return {
    name,
    arguments: args,
    agent: { session: { events } },
  }
}

describe('shouldObserve', () => {
  it('is silent on file_read/grep/glob/todo_write/skill', () => {
    const events = [call('file_read', { files: ['a.js'] }), call('file_read', { files: ['a.js'] })]
    assert.equal(shouldObserve(execWith(events, 'file_read', { files: ['a.js'] }), {}), false)
    assert.equal(shouldObserve(execWith(events, 'grep', { pattern: 'x' }), {}), false)
    assert.equal(shouldObserve(execWith(events, 'glob', { pattern: '*' }), {}), false)
    assert.equal(shouldObserve(execWith(events, 'todo_write', { todos: [] }), {}), false)
    assert.equal(shouldObserve(execWith(events, 'skill', { name: 'x' }), {}), false)
  })

  it('fires on error or block even for a first call', () => {
    const events = [call('pwsh', { command: 'node --test' })]
    const exec = execWith(events, 'pwsh', { command: 'node --test' })
    assert.equal(shouldObserve(exec, { isError: true }), true)
    assert.equal(shouldObserve(exec, { kind: 'block' }), true)
  })

  it('does not fire on two consecutive pwsh calls with different commands', () => {
    const events = [
      { type: 'turn/start' },
      call('pwsh', { command: 'node jsc.js find app.jsc --name isActive' }),
      { type: 'tool/result', data: {} },
      call('pwsh', { command: 'node jsc.js disasm app.jsc --index 13' }),
    ]
    const exec = execWith(events, 'pwsh', {
      command: 'node jsc.js disasm app.jsc --index 13',
    })
    assert.equal(shouldObserve(exec, { kind: 'accept' }), false)
  })

  it('fires on two consecutive identical pwsh arguments', () => {
    const args = { command: 'node --test tests/tool-observe.test.mjs' }
    const events = [{ type: 'turn/start' }, call('pwsh', args), call('pwsh', args)]
    assert.equal(shouldObserve(execWith(events, 'pwsh', args), { kind: 'accept' }), true)
  })

  it('does not fire on the first successful mutable call this turn', () => {
    const args = { command: 'node --test' }
    const events = [{ type: 'turn/start' }, call('pwsh', args)]
    assert.equal(shouldObserve(execWith(events, 'pwsh', args), { kind: 'accept' }), false)
  })

  it('does not count identical arguments from the previous turn', () => {
    const args = { command: 'node --test' }
    const events = [
      call('pwsh', args),
      call('pwsh', args),
      { type: 'turn/start' },
      call('pwsh', args),
    ]
    assert.equal(shouldObserve(execWith(events, 'pwsh', args), { kind: 'accept' }), false)
  })

  it('resets when a different tool name interrupts', () => {
    const args = { command: 'node --test' }
    const events = [
      { type: 'turn/start' },
      call('pwsh', args),
      call('file_read', { files: ['a.js'] }),
      call('pwsh', args),
    ]
    assert.equal(shouldObserve(execWith(events, 'pwsh', args), { kind: 'accept' }), false)
  })

  it('treats JSON-string arguments as equal to the parsed object', () => {
    const objectArgs = { command: 'node --test', description: 'Run tests' }
    const stringArgs = JSON.stringify({ description: 'Run tests', command: 'node --test' })
    const events = [
      { type: 'turn/start' },
      call('pwsh', stringArgs),
      call('pwsh', objectArgs),
    ]
    assert.equal(shouldObserve(execWith(events, 'pwsh', objectArgs), { kind: 'accept' }), true)
    const different = [
      { type: 'turn/start' },
      call('pwsh', JSON.stringify({ command: 'node jsc.js find' })),
      call('pwsh', { command: 'node jsc.js disasm' }),
    ]
    assert.equal(
      shouldObserve(execWith(different, 'pwsh', { command: 'node jsc.js disasm' }), { kind: 'accept' }),
      false,
    )
  })
})
describe('emptyEditDenial', () => {
  it('denies a file_edit whose files or file edits array is empty before the tool runs', () => {
    const emptyFiles = emptyEditDenial({ name: 'file_edit', arguments: { files: [] } })
    assert.match(emptyFiles, /denied before it ran/)
    assert.match(emptyFiles, /Do not retry/)
    const emptyEdits = emptyEditDenial({
      name: 'file_edit',
      arguments: { files: [{ file_path: 'A.java', edits: [] }] },
    })
    assert.match(emptyEdits, /edits array is empty/)
  })

  it('denies the same payload when arguments arrive as a JSON string', () => {
    const reason = emptyEditDenial({
      name: 'file_edit',
      arguments: JSON.stringify({ files: [{ file_path: 'A.java', edits: [] }] }),
    })
    assert.match(reason, /edits array is empty/)
  })

  it('lets a non-empty file_edit and every other tool through', () => {
    assert.equal(emptyEditDenial({
      name: 'file_edit',
      arguments: {
        files: [{ file_path: 'A.java', edits: [{ old_string: 'abc', new_string: 'x' }] }],
      },
    }), undefined)
    assert.equal(emptyEditDenial({ name: 'pwsh', arguments: { command: 'node --test' } }), undefined)
    assert.equal(emptyEditDenial({ name: 'file_edit', arguments: '{"files":' }), undefined)
  })
})