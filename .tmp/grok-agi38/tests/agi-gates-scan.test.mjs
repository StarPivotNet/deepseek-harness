import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { collectFacts, scanTurn } from '../agi-gates-scan.mjs'
import { isCognitionPath } from '../cognition-path.mjs'

const LEDGER = join(process.env.DSH_HOME, 'cognitions', 'proj', 'sess-1', 'cognition.md')
const OLD_LEDGER = join(process.env.DSH_HOME, 'cognitions', 'proj', 'cognition.md')
const SRC = 'src/app.mjs'
const NOTES = join(process.env.DSH_HOME, 'cognitions', 'proj', 'sess-1', 'notes.md')

function turnStart() {
  return { type: 'turn/start', time: 1 }
}

function toolCall(name, args, callId) {
  return {
    type: 'tool/call',
    data: { name, callId, arguments: args },
  }
}

function toolResult(callId, text) {
  return {
    type: 'tool/result',
    data: {
      callId,
      message: { callId, content: [{ type: 'text', text }] },
    },
  }
}

function assistant(text) {
  return {
    type: 'assistant/message',
    data: { message: { content: [{ type: 'text', text }] } },
  }
}

function proofOk(callId = 'pwsh-1') {
  return [
    toolCall('pwsh', { command: 'node --test' }, callId),
    toolResult(callId, 'ok\n[exit code: 0]'),
  ]
}

describe('isCognitionPath (scan contract)', () => {
  it('rejects the old two-segment cognitions path', () => {
    assert.equal(isCognitionPath(OLD_LEDGER), false)
    assert.equal(isCognitionPath('cognitions/proj/cognition.md'), false)
    assert.equal(isCognitionPath(LEDGER), true)
  })
})

describe('scanTurn ledger gate', () => {
  it('fires when src is edited without cognition.md', () => {
    const events = [
      turnStart(),
      toolCall('file_edit', { files: [{ file_path: SRC }] }, 'e1'),
      ...proofOk(),
    ]
    const facts = collectFacts(events)
    assert.equal(facts.ledger, true)
    const gate = scanTurn(events)
    assert.notEqual(gate, null)
    assert.equal(gate.id, 'ledger')
  })

  it('is silent when src and the session ledger are both edited', () => {
    const events = [
      turnStart(),
      toolCall('file_edit', { files: [{ file_path: SRC }] }, 'e1'),
      toolCall('file_edit', { files: [{ file_path: LEDGER }] }, 'e2'),
      ...proofOk(),
    ]
    assert.equal(collectFacts(events).ledger, false)
    assert.equal(scanTurn(events), null)
  })

  it('is silent when only the ledger is edited', () => {
    const events = [
      turnStart(),
      toolCall('file_write', { file_path: LEDGER }, 'w1'),
    ]
    assert.equal(collectFacts(events).ledger, false)
    assert.equal(scanTurn(events), null)
  })

  it('is silent when only pwsh ran', () => {
    const events = [turnStart(), ...proofOk()]
    assert.equal(collectFacts(events).ledger, false)
    assert.equal(scanTurn(events), null)
  })

  it('still fires when src plus an old two-segment path is edited', () => {
    const events = [
      turnStart(),
      toolCall('file_edit', { files: [{ file_path: SRC }] }, 'e1'),
      toolCall('file_edit', { files: [{ file_path: OLD_LEDGER }] }, 'e2'),
      ...proofOk(),
    ]
    assert.equal(isCognitionPath(OLD_LEDGER), false)
    assert.equal(collectFacts(events).ledger, true)
  })

  it('ignores options.ledgerStale leftover', () => {
    const events = [
      turnStart(),
      toolCall('file_edit', { files: [{ file_path: SRC }] }, 'e1'),
      toolCall('file_edit', { files: [{ file_path: LEDGER }] }, 'e2'),
      ...proofOk(),
    ]
    assert.equal(collectFacts(events, { ledgerStale: true }).ledger, false)
  })

  it('counts a file_move as two mutated paths and requires proof', () => {
    const events = [
      turnStart(),
      toolCall('file_move', { from: SRC, to: 'src/moved.mjs' }, 'm1'),
    ]
    const facts = collectFacts(events)
    assert.equal(facts.mutatedCount, 2)
    assert.equal(facts.acceptance, true)
  })

  it('is silent when only notes.md is edited (notes skipped as mutation)', () => {
    const events = [
      turnStart(),
      toolCall('file_edit', { files: [{ file_path: NOTES }] }, 'n1'),
    ]
    const facts = collectFacts(events)
    assert.equal(facts.ledger, false)
    assert.equal(facts.ledgerUpdatedThisTurn, false)
    assert.equal(facts.mutatedCount, 0)
    assert.equal(scanTurn(events), null)
  })

  it('fires when src plus notes.md are edited without cognition.md', () => {
    const events = [
      turnStart(),
      toolCall('file_edit', { files: [{ file_path: SRC }] }, 'e1'),
      toolCall('file_edit', { files: [{ file_path: NOTES }] }, 'n1'),
      ...proofOk(),
    ]
    const facts = collectFacts(events)
    assert.equal(facts.ledgerUpdatedThisTurn, false)
    assert.equal(facts.ledger, true)
    const gate = scanTurn(events)
    assert.notEqual(gate, null)
    assert.equal(gate.id, 'ledger')
  })
})

const SRC2 = 'src/lib.mjs'

function twoImplWithProofAndLedger() {
  return [
    turnStart(),
    toolCall('file_edit', { files: [{ file_path: SRC }] }, 'e1'),
    toolCall('file_edit', { files: [{ file_path: SRC2 }] }, 'e2'),
    toolCall('file_edit', { files: [{ file_path: LEDGER }] }, 'e3'),
    ...proofOk(),
  ]
}

describe('scanTurn critic gate', () => {
  it('fires when two impl files change with no reviewer', () => {
    const events = twoImplWithProofAndLedger()
    const facts = collectFacts(events)
    assert.equal(facts.critic, true)
    assert.equal(facts.hasReview, false)
    const gate = scanTurn(events)
    assert.notEqual(gate, null)
    assert.equal(gate.id, 'critic')
  })

  it('does not treat a mapping subagent as review', () => {
    const events = [
      ...twoImplWithProofAndLedger(),
      toolCall('subagent', { description: 'Map auth module', prompt: 'List src files' }, 's1'),
    ]
    const facts = collectFacts(events)
    assert.equal(facts.hasReview, false)
    assert.equal(facts.critic, true)
    assert.equal(scanTurn(events).id, 'critic')
  })

  it('does not treat a Review-named mapping subagent as review', () => {
    const events = [
      ...twoImplWithProofAndLedger(),
      toolCall('subagent', { description: 'Review src diff', prompt: 'List src files' }, 's2'),
    ]
    const facts = collectFacts(events)
    assert.equal(facts.hasReview, false)
    assert.equal(facts.critic, true)
    assert.equal(scanTurn(events).id, 'critic')
  })

  it('does not treat team create or implementation tasks as review', () => {
    const events = [
      ...twoImplWithProofAndLedger(),
      toolCall('agent_teams_create', { name: 'fix', approval: 'automatic' }, 't1'),
      toolCall('agent_teams_create_task', { subject: 'patch src', kind: 'implementation' }, 't2'),
      toolCall('agent_teams_reassign_task', { task_id: 'x', assignee: 'eng' }, 't3'),
    ]
    const facts = collectFacts(events)
    assert.equal(facts.hasReview, false)
    assert.equal(facts.critic, true)
  })

  it('accepts send_message to the standing reviewer and a session-reviewer spawn', () => {
    const handed = [
      ...twoImplWithProofAndLedger(),
      toolCall(
        'send_message',
        {
          agent_id: 'reviewer-1',
          message: 'You are a read-only Senior Code Reviewer. Review the completed work.',
        },
        'm1',
      ),
    ]
    assert.equal(collectFacts(handed).hasReview, true)
    assert.equal(collectFacts(handed).critic, false)

    const spawned = [
      ...twoImplWithProofAndLedger(),
      toolCall('subagent', { description: 'session reviewer', prompt: 'Review the diff.' }, 'r0'),
    ]
    assert.equal(collectFacts(spawned).hasReview, true)
    assert.equal(collectFacts(spawned).critic, false)

    const chatter = [
      ...twoImplWithProofAndLedger(),
      toolCall('send_message', { agent_id: 'other', message: 'status?' }, 'm2'),
    ]
    assert.equal(collectFacts(chatter).hasReview, false)
    assert.equal(collectFacts(chatter).critic, true)
  })

  it('accepts a reviewer subagent', () => {
    const events = [
      ...twoImplWithProofAndLedger(),
      toolCall(
        'subagent',
        {
          description: 'Review src diff',
          prompt: 'You are a read-only Senior Code Reviewer. Review the completed work.',
        },
        'r1',
      ),
    ]
    const facts = collectFacts(events)
    assert.equal(facts.hasReview, true)
    assert.equal(facts.critic, false)
    assert.equal(scanTurn(events), null)
  })

  it('accepts AgentTeams kind=review or a review verdict', () => {
    const createReview = [
      ...twoImplWithProofAndLedger(),
      toolCall('agent_teams_create_task', { subject: 'review patch', kind: 'review' }, 'rv1'),
    ]
    assert.equal(collectFacts(createReview).hasReview, true)
    assert.equal(collectFacts(createReview).critic, false)

    const verdict = [
      ...twoImplWithProofAndLedger(),
      toolCall('agent_teams_update_task', { task_id: 'rv', verdict: 'pass' }, 'rv2'),
    ]
    assert.equal(collectFacts(verdict).hasReview, true)
    assert.equal(collectFacts(verdict).critic, false)
  })

  it('does not fire for a single impl file', () => {
    const events = [
      turnStart(),
      toolCall('file_edit', { files: [{ file_path: SRC }] }, 'e1'),
      toolCall('file_edit', { files: [{ file_path: LEDGER }] }, 'e2'),
      ...proofOk(),
    ]
    assert.equal(collectFacts(events).critic, false)
    assert.equal(scanTurn(events), null)
  })
})

describe('scanTurn stuck gate', () => {
  it('does not fire for two consecutive pwsh calls with different arguments', () => {
    const events = [
      turnStart(),
      toolCall('pwsh', { command: 'node a.js' }, 'p1'),
      toolResult('p1', 'ok\n[exit code: 0]'),
      toolCall('pwsh', { command: 'node b.js' }, 'p2'),
      toolResult('p2', 'ok\n[exit code: 0]'),
    ]
    const facts = collectFacts(events)
    assert.equal(facts.stuck, false)
    assert.equal(scanTurn(events), null)
  })

  it('does not fire for two consecutive web_search calls with different queries', () => {
    const events = [
      turnStart(),
      toolCall('web_search', { queries: ['alpha'] }, 'w1'),
      toolCall('web_search', { queries: ['beta'] }, 'w2'),
    ]
    assert.equal(collectFacts(events).stuck, false)
    assert.equal(scanTurn(events), null)
  })

  it('fires when the same retry tool runs twice with identical arguments', () => {
    const args = { command: 'node --test' }
    const events = [
      turnStart(),
      toolCall('pwsh', args, 'p1'),
      toolResult('p1', 'fail\n[exit code: 1]'),
      toolCall('pwsh', args, 'p2'),
      toolResult('p2', 'fail\n[exit code: 1]'),
    ]
    const facts = collectFacts(events)
    assert.equal(facts.stuck, true)
    assert.equal(facts.stuckCount, 2)
    assert.equal(facts.stuckName, 'pwsh')
    const gate = scanTurn(events)
    assert.notEqual(gate, null)
    assert.equal(gate.id, 'stuck')
  })

  it('fires when consecutive pwsh calls have the same args with shuffled keys', () => {
    const events = [
      turnStart(),
      toolCall('pwsh', { command: 'node --test', description: 'Run tests' }, 'p1'),
      toolResult('p1', 'fail\n[exit code: 1]'),
      toolCall('pwsh', { description: 'Run tests', command: 'node --test' }, 'p2'),
      toolResult('p2', 'fail\n[exit code: 1]'),
    ]
    const facts = collectFacts(events)
    assert.equal(facts.stuck, true)
    assert.equal(facts.stuckCount, 2)
    assert.equal(facts.stuckName, 'pwsh')
    assert.equal(scanTurn(events).id, 'stuck')
  })

  it('fires when one call is a JSON string with shuffled keys', () => {
    const objectArgs = { command: 'node --test', description: 'Run tests' }
    const stringArgs = JSON.stringify({ description: 'Run tests', command: 'node --test' })
    const events = [
      turnStart(),
      toolCall('pwsh', stringArgs, 'p1'),
      toolResult('p1', 'fail\n[exit code: 1]'),
      toolCall('pwsh', objectArgs, 'p2'),
      toolResult('p2', 'fail\n[exit code: 1]'),
    ]
    const facts = collectFacts(events)
    assert.equal(facts.stuck, true)
    assert.equal(facts.stuckCount, 2)
    assert.equal(scanTurn(events).id, 'stuck')
  })
})

describe('scanTurn acceptance gate', () => {
  it('fires when an impl file is edited with no this-turn proof', () => {
    const events = [
      turnStart(),
      toolCall('file_edit', { files: [{ file_path: SRC }] }, 'e1'),
      toolCall('file_edit', { files: [{ file_path: LEDGER }] }, 'e2'),
    ]
    const facts = collectFacts(events)
    assert.equal(facts.acceptance, true)
    assert.equal(facts.stuck, false)
    const gate = scanTurn(events)
    assert.notEqual(gate, null)
    assert.equal(gate.id, 'acceptance')
  })

  it('is silent when the this-turn proof exits 0', () => {
    const events = [
      turnStart(),
      toolCall('file_edit', { files: [{ file_path: SRC }] }, 'e1'),
      toolCall('file_edit', { files: [{ file_path: LEDGER }] }, 'e2'),
      ...proofOk(),
    ]
    assert.equal(collectFacts(events).acceptance, false)
    assert.equal(scanTurn(events), null)
  })

  it('stays failing when a failed proof is followed by an unrelated exit-0 shell', () => {
    const events = [
      turnStart(),
      toolCall('file_edit', { files: [{ file_path: SRC }] }, 'e1'),
      toolCall('file_edit', { files: [{ file_path: LEDGER }] }, 'e2'),
      toolCall('pwsh', { command: 'node --test' }, 'p1'),
      toolResult('p1', 'fail\n[exit code: 1]'),
      toolCall('pwsh', { command: 'git status' }, 'p2'),
      toolResult('p2', 'ok\n[exit code: 0]'),
    ]
    const facts = collectFacts(events)
    assert.equal(facts.proofFail, true)
    assert.equal(facts.proofOk, false)
    assert.equal(facts.lastProofExit, 1)
    assert.equal(facts.acceptance, true)
    assert.equal(scanTurn(events).id, 'acceptance')
  })

  it('is silent when a failed proof is followed by a passing proof of the same claim', () => {
    const events = [
      turnStart(),
      toolCall('file_edit', { files: [{ file_path: SRC }] }, 'e1'),
      toolCall('file_edit', { files: [{ file_path: LEDGER }] }, 'e2'),
      toolCall('pwsh', { command: 'node --test' }, 'p1'),
      toolResult('p1', 'fail\n[exit code: 1]'),
      toolCall('pwsh', { command: 'node --test', description: 'Retry the suite' }, 'p2'),
      toolResult('p2', 'ok\n[exit code: 0]'),
    ]
    const facts = collectFacts(events)
    assert.equal(facts.proofFail, false)
    assert.equal(facts.proofOk, true)
    assert.equal(facts.lastProofExit, 0)
    assert.equal(facts.acceptance, false)
    assert.equal(scanTurn(events), null)
  })
})

describe('scanTurn deferral gate', () => {
  it('fires when the closing text offers later work', () => {
    const events = [turnStart(), assistant('I can add the sibling handler if you want.')]
    const facts = collectFacts(events)
    assert.equal(facts.deferral, true)
    const gate = scanTurn(events)
    assert.equal(gate.id, 'deferral')
    assert.match(gate.text, /agi-gates:deferral/)
    assert.match(gate.text, /Do not offer/)
  })

  it('fires on the Chinese offer phrases', () => {
    for (const text of ['如果需要我可以再补一个校验', '要不要我把边界也写上', '我可以再跑一遍相关用例']) {
      const gate = scanTurn([turnStart(), assistant(text)])
      assert.equal(gate && gate.id, 'deferral', text)
    }
    const gate = scanTurn([turnStart(), assistant('Let me know if you want the other file too.')])
    assert.equal(gate.id, 'deferral')
  })

  it('is silent when the reply admits it is unverified or blocked', () => {
    const events = [turnStart(), assistant('未验证。如果需要我可以再补测试。')]
    assert.equal(collectFacts(events).deferral, false)
    assert.equal(scanTurn(events), null)
    const blocked = [turnStart(), assistant('This is blocked. I can add it if you want after the key exists.')]
    assert.equal(collectFacts(blocked).deferral, false)
    assert.equal(scanTurn(blocked), null)
  })

  it('is silent in plan mode', () => {
    const events = [
      turnStart(),
      toolCall('enter_plan_mode', {}, 'plan-1'),
      assistant('I can sketch the other module if you want.'),
    ]
    const facts = collectFacts(events)
    assert.equal(facts.planMode, true)
    assert.equal(facts.deferral, false)
    assert.equal(scanTurn(events), null)
  })

  it('loses to stuck when both would fire', () => {
    const args = { command: 'node --test' }
    const events = [
      turnStart(),
      toolCall('pwsh', args, 'p1'),
      toolResult('p1', 'fail\n[exit code: 1]'),
      toolCall('pwsh', args, 'p2'),
      toolResult('p2', 'fail\n[exit code: 1]'),
      assistant('I can retry a different command if you want.'),
    ]
    assert.equal(collectFacts(events).deferral, true)
    assert.equal(scanTurn(events).id, 'stuck')
  })

  it('is silent when the reply does not offer later work', () => {
    const events = [turnStart(), assistant('The handler now covers the empty input.')]
    assert.equal(collectFacts(events).deferral, false)
    assert.equal(scanTurn(events), null)
  })
})


