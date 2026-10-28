import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import {
  normalizePath,
  sessionIdOf,
  cwdOf,
  ledgerPathFor,
  isCognitionPath,
  notesPathFor,
  isNotesPath,
  isSessionMemoryPath,
} from '../cognition-path.mjs'

describe('normalizePath', () => {
  it('converts backslash to slash', () => {
    assert.equal(normalizePath('C:\\Users\\a\\b'), 'C:/Users/a/b')
  })
})

describe('sessionIdOf', () => {
  it('reads session.id when it is a string', () => {
    assert.equal(sessionIdOf({ id: 'sess-1' }), 'sess-1')
  })

  it('reads agent.session.id', () => {
    assert.equal(sessionIdOf({ session: { id: 'agent-sess' } }), 'agent-sess')
  })

  it('returns empty string when id is missing; stringifies numbers', () => {
    assert.equal(sessionIdOf(null), '')
    assert.equal(sessionIdOf({}), '')
    assert.equal(sessionIdOf({ id: 12 }), '12')
  })

})

describe('cwdOf', () => {
  it('prefers initiator/agent.options.cwd then session.header.cwd', () => {
    assert.equal(cwdOf({ options: { cwd: 'D:\\work\\proj' } }), 'D:\\work\\proj')
    assert.equal(
      cwdOf({ options: {} }, { header: { cwd: '/tmp/ws' } }),
      '/tmp/ws',
    )
    assert.equal(cwdOf(null), '')
  })
})

describe('ledgerPathFor', () => {
  it('builds $DSH_HOME/cognitions/<project>/<sessionId>/cognition.md segments', () => {
    const prev = process.env.DSH_HOME
    process.env.DSH_HOME = 'C:\\dsh-home'
    try {
      const path = ledgerPathFor('D:\\desktop\\desktop\\Jnic', 'abc123')
      assert.equal(
        normalizePath(path),
        'C:/dsh-home/cognitions/Jnic/abc123/cognition.md',
      )
    } finally {
      if (prev === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prev
    }
  })

  it('sanitizes project and sessionId; undefined when cwd or sessionId empty', () => {
    const prev = process.env.DSH_HOME
    process.env.DSH_HOME = '/opt/dsh'
    try {
      const path = ledgerPathFor('C:\\work\\foo:bar', 'sess/id extra')
      assert.equal(
        normalizePath(path),
        '/opt/dsh/cognitions/foo_bar/sess_id_extra/cognition.md',
      )
      assert.equal(ledgerPathFor('', 'abc'), undefined)
      assert.equal(ledgerPathFor('C:\\work\\proj', ''), undefined)
    } finally {
      if (prev === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prev
    }
  })

  it('uses the separator from DSH_HOME so a POSIX home is not mixed with backslashes', () => {
    const prev = process.env.DSH_HOME
    process.env.DSH_HOME = '/opt/dsh'
    try {
      const path = ledgerPathFor('/work/proj', 'sess-1')
      assert.equal(path.includes('\\'), false)
      assert.equal(path, '/opt/dsh/cognitions/proj/sess-1/cognition.md')
    } finally {
      if (prev === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prev
    }
  })
})

describe('isCognitionPath', () => {
  it('is true for three-segment cognitions/<project>/<sessionId>/cognition.md', () => {
    assert.equal(
      isCognitionPath(join(process.env.DSH_HOME, 'cognitions', 'Jnic', 'abc123', 'cognition.md')),
      true,
    )
    assert.equal(
      isCognitionPath('/home/u/.dsh/cognitions/proj/sess-id/cognition.md'),
      true,
    )
  })

  it('is false for two-segment, workspace .dsh, and non-ledger files', () => {
    assert.equal(isCognitionPath('cognitions/proj/cognition.md'), false)
    assert.equal(
      isCognitionPath(join(process.env.DSH_HOME, 'cognitions', 'Jnic', 'cognition.md')),
      false,
    )
    assert.equal(isCognitionPath('workspace/.dsh/cognition.md'), false)
    assert.equal(isCognitionPath('C:\\proj\\.dsh\\cognition.md'), false)
    assert.equal(isCognitionPath('src/app.mjs'), false)
  })
})

describe('notesPathFor', () => {
  it('builds $DSH_HOME/cognitions/<project>/<sessionId>/notes.md segments', () => {
    const prev = process.env.DSH_HOME
    process.env.DSH_HOME = 'C:\\dsh-home'
    try {
      const path = notesPathFor('D:\\desktop\\desktop\\Jnic', 'abc123')
      assert.equal(
        normalizePath(path),
        'C:/dsh-home/cognitions/Jnic/abc123/notes.md',
      )
    } finally {
      if (prev === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prev
    }
  })

  it('sanitizes project and sessionId; undefined when cwd or sessionId empty', () => {
    const prev = process.env.DSH_HOME
    process.env.DSH_HOME = '/opt/dsh'
    try {
      const path = notesPathFor('C:\\work\\foo:bar', 'sess/id extra')
      assert.equal(
        normalizePath(path),
        '/opt/dsh/cognitions/foo_bar/sess_id_extra/notes.md',
      )
      assert.equal(notesPathFor('', 'abc'), undefined)
      assert.equal(notesPathFor('C:\\work\\proj', ''), undefined)
    } finally {
      if (prev === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prev
    }
  })

  it('uses the separator from DSH_HOME so a POSIX home is not mixed with backslashes', () => {
    const prev = process.env.DSH_HOME
    process.env.DSH_HOME = '/opt/dsh'
    try {
      const path = notesPathFor('/work/proj', 'sess-1')
      assert.equal(path.includes('\\'), false)
      assert.equal(path, '/opt/dsh/cognitions/proj/sess-1/notes.md')
    } finally {
      if (prev === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prev
    }
  })
})

describe('isNotesPath', () => {
  it('is true for three-segment cognitions/<project>/<sessionId>/notes.md', () => {
    assert.equal(
      isNotesPath(join(process.env.DSH_HOME, 'cognitions', 'Jnic', 'abc123', 'notes.md')),
      true,
    )
    assert.equal(
      isNotesPath('/home/u/.dsh/cognitions/proj/sess-id/notes.md'),
      true,
    )
  })

  it('is false for two-segment, workspace .dsh/notes.md, and non-notes files', () => {
    assert.equal(isNotesPath('cognitions/proj/notes.md'), false)
    assert.equal(
      isNotesPath(join(process.env.DSH_HOME, 'cognitions', 'Jnic', 'notes.md')),
      false,
    )
    assert.equal(isNotesPath('workspace/.dsh/notes.md'), false)
    assert.equal(isNotesPath('C:\\proj\\.dsh\\notes.md'), false)
    assert.equal(isNotesPath('src/app.mjs'), false)
    assert.equal(
      isNotesPath(join(process.env.DSH_HOME, 'cognitions', 'Jnic', 'abc123', 'cognition.md')),
      false,
    )
  })
})

describe('isCognitionPath vs notes.md', () => {
  it('stays false for three-segment notes.md so notes cannot close the ledger gate', () => {
    assert.equal(
      isCognitionPath(join(process.env.DSH_HOME, 'cognitions', 'Jnic', 'abc123', 'notes.md')),
      false,
    )
    assert.equal(
      isCognitionPath('/home/u/.dsh/cognitions/proj/sess-id/notes.md'),
      false,
    )
  })
})

describe('isSessionMemoryPath', () => {
  it('is true for either three-segment cognition.md or notes.md', () => {
    assert.equal(
      isSessionMemoryPath(join(process.env.DSH_HOME, 'cognitions', 'Jnic', 'abc123', 'cognition.md')),
      true,
    )
    assert.equal(
      isSessionMemoryPath(join(process.env.DSH_HOME, 'cognitions', 'Jnic', 'abc123', 'notes.md')),
      true,
    )
    assert.equal(
      isSessionMemoryPath('/home/u/.dsh/cognitions/proj/sess-id/cognition.md'),
      true,
    )
    assert.equal(
      isSessionMemoryPath('/home/u/.dsh/cognitions/proj/sess-id/notes.md'),
      true,
    )
  })

  it('is false for two-segment paths and workspace .dsh/notes.md', () => {
    assert.equal(isSessionMemoryPath('cognitions/proj/notes.md'), false)
    assert.equal(isSessionMemoryPath('workspace/.dsh/notes.md'), false)
    assert.equal(isSessionMemoryPath('C:\\proj\\.dsh\\notes.md'), false)
    assert.equal(isSessionMemoryPath('src/app.mjs'), false)
  })
})
