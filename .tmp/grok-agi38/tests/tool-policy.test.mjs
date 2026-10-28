import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  apply,
  childWriteDecision,
  outboundDecision,
  planWriteReason,
} from '../tool-policy.mjs'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const CORDIS = join(PRESET_ROOT, 'agent.cordis.yml')
const LEDGER = join(process.env.DSH_HOME, 'cognitions', 'proj', 'sess-1', 'cognition.md')
const NOTES = join(process.env.DSH_HOME, 'cognitions', 'proj', 'sess-1', 'notes.md')

function exec(name, args, agent) {
  return { name, arguments: args, agent }
}

function rootAgent(overrides = {}) {
  return {
    id: 'root-1',
    session: { header: { cwd: 'D:\\work\\proj' }, events: [] },
    options: {},
    ctx: {
      tools: {
        get(name) {
          return { name }
        },
      },
    },
    ...overrides,
  }
}

function childAgent(overrides = {}) {
  return {
    id: 'child-1',
    session: {
      header: {
        origin: 'subagent',
        parentSession: 'root-1',
        cwd: 'D:\\work\\proj',
        delegationDepth: 1,
      },
      events: [],
    },
    options: { subagentDepth: 1 },
    ctx: {
      tools: {
        get(name) {
          return { name }
        },
      },
    },
    ...overrides,
  }
}

function forkedBranchAgent(overrides = {}) {
  return {
    id: 'fork-1',
    session: {
      header: {
        parentSession: 'root-1',
        isSeeded: true,
        cwd: 'D:\\work\\proj',
      },
      events: [],
    },
    options: {},
    ctx: {
      tools: {
        get(name) {
          return { name }
        },
      },
    },
    ...overrides,
  }
}

function memberAgent() {
  const hidden = new Set(['agent_teams_create', 'agent_teams_approve'])
  const memberVisible = new Set([
    'agent_teams_claim_task',
    'agent_teams_update_task',
    'agent_teams_send_message',
    'agent_teams_status',
  ])
  return childAgent({
    id: 'member-1',
    ctx: {
      tools: {
        get(name) {
          if (hidden.has(name)) return undefined
          if (memberVisible.has(name)) return { name }
          return { name }
        },
      },
    },
  })
}


describe('planWriteReason', () => {
  it('denies file_write/file_edit while plan mode is active or pending-on', () => {
    const agent = rootAgent()
    const active = { get: () => ({ active: true }) }
    const pendingOn = { get: () => ({ active: false, pending: true }) }
    const off = { get: () => ({ active: false }) }

    assert.match(planWriteReason(exec('file_edit', { files: [{ file_path: 'src/app.mjs', edits: [] }] }, agent), active), /plan mode/i)
    assert.match(planWriteReason(exec('file_write', { file_path: 'src/new.mjs' }, agent), pendingOn), /plan mode/i)
    assert.equal(planWriteReason(exec('file_edit', { files: [{ file_path: 'src/app.mjs', edits: [] }] }, agent), off), undefined)
    assert.match(planWriteReason(exec('pwsh', { command: 'Set-Content src/app.mjs x' }, agent), active), /plan mode/i)
    assert.match(planWriteReason(exec('pwsh', { command: 'Get-Content src/app.mjs | Set-Content src/out.mjs' }, agent), active), /plan mode/i)
    assert.match(planWriteReason(exec('agent_teams_create', { name: 'impl' }, agent), active), /plan mode/i)
    assert.equal(planWriteReason(exec('pwsh', { command: 'node --test' }, agent), active), undefined)
    assert.equal(planWriteReason(exec('file_read', { files: ['src/app.mjs'] }, agent), active), undefined)
    assert.match(planWriteReason(exec('file_move', { from: 'src/a.mjs', to: 'src/b.mjs' }, agent), active), /plan mode/i)
  })

  it('still allows the session cognition ledger during plan mode', () => {
    const agent = rootAgent()
    const active = { get: () => ({ active: true }) }
    assert.equal(planWriteReason(exec('file_edit', { files: [{ file_path: LEDGER, edits: [] }] }, agent), active), undefined)
    assert.equal(planWriteReason(exec('file_write', { file_path: LEDGER }, agent), active), undefined)
  })

  it('still allows the session notes.md during plan mode', () => {
    const agent = rootAgent()
    const active = { get: () => ({ active: true }) }
    assert.equal(planWriteReason(exec('file_edit', { files: [{ file_path: NOTES, edits: [] }] }, agent), active), undefined)
    assert.equal(planWriteReason(exec('file_write', { file_path: NOTES }, agent), active), undefined)
  })

  it('reads ctx.planMode.get(agent) and does not guess from session logs', () => {
    const agent = rootAgent({
      session: {
        header: {},
        events: [{ type: 'tool/call', data: { name: 'enter_plan_mode', callId: 'x' } }],
      },
    })
    let seen
    const planMode = {
      get(target) {
        seen = target
        return { active: true }
      },
    }
    const reason = planWriteReason(exec('file_edit', { files: [{ file_path: 'a.js', edits: [] }] }, agent), planMode)
    assert.equal(seen, agent)
    assert.match(reason, /plan mode/i)
  })
})

describe('childWriteDecision', () => {
  it('denies file_write/file_edit for a delegated subagent that is not an AgentTeams member', () => {
    const child = childAgent()
    const denied = childWriteDecision(exec('file_edit', { files: [{ file_path: 'src/app.mjs', edits: [] }] }, child))
    assert.equal(denied.kind, 'deny')
    assert.match(denied.reason, /subagent|delegat/i)
    assert.equal(childWriteDecision(exec('file_write', { file_path: 'src/app.mjs' }, child)).kind, 'deny')
    assert.equal(childWriteDecision(exec('file_move', { from: 'src/a.mjs', to: 'src/b.mjs' }, child)).kind, 'deny')

    const allowed = childWriteDecision(exec('file_read', { files: ['src/app.mjs'] }, child))
    assert.equal(allowed.kind, 'allow')

    const root = childWriteDecision(exec('file_edit', { files: [{ file_path: 'src/app.mjs', edits: [] }] }, rootAgent()))
    assert.equal(root.kind, 'allow')
  })

  it('allows forked conversation branches (parentSession without subagent origin/depth)', () => {
    const fork = forkedBranchAgent()
    assert.equal(childWriteDecision(exec('file_edit', { files: [{ file_path: 'src/app.mjs', edits: [] }] }, fork)).kind, 'allow')
    assert.equal(childWriteDecision(exec('file_write', { file_path: 'src/app.mjs' }, fork)).kind, 'allow')
    assert.equal(childWriteDecision(exec('pwsh', { command: 'Set-Content src/app.mjs x' }, fork)).kind, 'allow')
  })

  it('still denies a child identified only by header delegationDepth', () => {
    const child = forkedBranchAgent({
      session: {
        header: {
          parentSession: 'root-1',
          isSeeded: true,
          delegationDepth: 1,
          cwd: 'D:\\work\\proj',
        },
        events: [],
      },
    })
    assert.equal(childWriteDecision(exec('file_edit', { files: [{ file_path: 'src/app.mjs', edits: [] }] }, child)).kind, 'deny')
  })

  it('still denies a child identified only by options subagentDepth', () => {
    const child = forkedBranchAgent({ options: { subagentDepth: 1 } })
    assert.equal(childWriteDecision(exec('file_edit', { files: [{ file_path: 'src/app.mjs', edits: [] }] }, child)).kind, 'deny')
  })

  it('allows AgentTeams members to mutate (captain tools are restricted away)', () => {
    const member = memberAgent()
    const decision = childWriteDecision(exec('file_edit', { files: [{ file_path: 'src/app.mjs', edits: [] }] }, member))
    assert.equal(decision.kind, 'allow')
  })

  it('still denies a child whose tools.get cannot see any team tools', () => {
    const child = childAgent({
      ctx: {
        tools: {
          get() {
            return undefined
          },
        },
      },
    })
    const decision = childWriteDecision(exec('file_edit', { files: [{ file_path: 'src/app.mjs', edits: [] }] }, child))
    assert.equal(decision.kind, 'deny')
  })

  it('still denies a child that is missing only one captain tool', () => {
    const child = childAgent({
      ctx: {
        tools: {
          get(name) {
            if (name === 'agent_teams_create') return undefined
            return { name }
          },
        },
      },
    })
    assert.equal(childWriteDecision(exec('file_edit', { files: [{ file_path: 'src/app.mjs', edits: [] }] }, child)).kind, 'deny')
  })

  it('denies shell writes for a delegated subagent and allows read-only commands', () => {
    const child = childAgent()
    for (const command of [
      'Set-Content src/app.mjs x',
      'Get-Content src/app.mjs | Set-Content src/out.mjs',
      'echo hello > src/out.txt',
      'git commit -m change',
    ]) {
      const denied = childWriteDecision(exec('pwsh', { command }, child))
      assert.equal(denied.kind, 'deny', command)
    }
    assert.equal(childWriteDecision(exec('pwsh', { command: 'node --test' }, child)).kind, 'allow')
    assert.equal(childWriteDecision(exec('pwsh', { command: 'Set-Content src/app.mjs x' }, rootAgent())).kind, 'allow')
    const member = memberAgent()
    assert.equal(childWriteDecision(exec('pwsh', { command: 'Set-Content src/app.mjs x' }, member)).kind, 'allow')
  })

})

describe('outboundDecision', () => {
  it('asks before web_fetch to a non-public or non-http(s) target', () => {
    const agent = rootAgent()
    for (const url of [
      'http://127.0.0.1:43120',
      'https://localhost/admin',
      'http://192.168.1.1/',
      'http://10.0.0.5/secret',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/',
      'http://[fc00::1]/',
      'http://[fe80::1]/',
      'http://[::ffff:127.0.0.1]/',
      'file:///etc/passwd',
    ]) {
      const decision = outboundDecision(exec('web_fetch', { url }, agent))
      assert.equal(decision.kind, 'ask', url)
      assert.match(decision.reason, /outbound|private|non-public|local/i)
    }
  })

  it('allows public http(s) fetch and ignores other tools', () => {
    const agent = rootAgent()
    assert.equal(outboundDecision(exec('web_fetch', { url: 'https://example.com/doc' }, agent)).kind, 'allow')
    assert.equal(outboundDecision(exec('web_fetch', { url: 'https://facebook.com' }, agent)).kind, 'allow')
    assert.equal(outboundDecision(exec('web_fetch', { url: 'https://fdn.example.org' }, agent)).kind, 'allow')
    assert.equal(outboundDecision(exec('web_search', { queries: ['x'] }, agent)).kind, 'allow')
    assert.equal(outboundDecision(exec('file_read', { files: ['a.js'] }, agent)).kind, 'allow')
  })
})

describe('tool-policy apply', () => {
  it('registers a tools.guard and a tools/pre-execute listener', () => {
    const guards = []
    const ons = []
    apply({
      tools: {
        guard(fn) {
          guards.push(fn)
          return () => {}
        },
        restrict() {
          assert.fail('do not call tools.restrict()')
        },
      },
      planMode: {
        get: () => ({ active: true }),
      },
      on(event, handler) {
        ons.push({ event, handler })
      },
    })
    assert.equal(guards.length, 1)
    assert.equal(typeof guards[0], 'function')
    const pre = ons.find((row) => row.event === 'tools/pre-execute')
    assert.ok(pre)
    assert.equal(typeof pre.handler, 'function')
  })

  it('guard denies an in-plan edit via planMode.get, not session log scraping', async () => {
    const guards = []
    apply({
      tools: {
        guard(fn) {
          guards.push(fn)
          return () => {}
        },
      },
      planMode: {
        get: () => ({ active: true }),
      },
      on() {},
    })
    const reason = guards[0](exec('file_edit', { files: [{ file_path: 'src/app.mjs', edits: [] }] }, rootAgent()))
    assert.match(reason, /plan mode/i)
  })

  it('guard also denies a delegated subagent edit', () => {
    const guards = []
    apply({
      tools: {
        guard(fn) {
          guards.push(fn)
          return () => {}
        },
      },
      planMode: { get: () => ({ active: false }) },
      on() {},
    })
    const reason = guards[0](exec('file_edit', { files: [{ file_path: 'src/app.mjs', edits: [] }] }, childAgent()))
    assert.match(reason, /subagent|delegat/i)
    assert.equal(guards[0](exec('file_edit', { files: [{ file_path: 'src/app.mjs', edits: [] }] }, memberAgent())), undefined)
    assert.equal(guards[0](exec('file_read', { files: ['src/app.mjs'] }, childAgent())), undefined)
  })

  it('pre-execute denies a subagent edit and asks on private web_fetch', async () => {
    let handler
    apply({
      tools: {
        guard() {
          return () => {}
        },
      },
      planMode: { get: () => ({ active: false }) },
      on(event, fn) {
        if (event === 'tools/pre-execute') handler = fn
      },
    })
    const next = async () => ({ kind: 'allow' })
    const denied = await handler(exec('file_write', { file_path: 'src/x.js' }, childAgent()), next)
    assert.equal(denied.kind, 'deny')

    const asked = await handler(exec('web_fetch', { url: 'http://127.0.0.1/' }, rootAgent()), next)
    assert.equal(asked.kind, 'ask')

    const allowed = await handler(exec('file_read', { files: ['src/x.js'] }, childAgent()), next)
    assert.equal(allowed.kind, 'allow')
  })
})

describe('preset composition', () => {
  it('mounts tool-policy in the planMode isolate next to enter-plan-mode', () => {
    const cordis = readFileSync(CORDIS, 'utf8')
    assert.match(cordis, /id: enter-plan-mode[\s\S]*id: tool-policy[\s\S]*name: \.\/tool-policy\.mjs/)
    assert.match(cordis, /isolate:\s*\n\s*planMode: true/)
    assert.equal(cordis.includes('tools.restrict'), false)
    assert.equal(cordis.includes('planMode.isActive'), false)
    assert.equal(cordis.includes('ctx.present()'), false)
  })
})
