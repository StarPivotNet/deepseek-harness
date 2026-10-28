/**
 * Structural check of the rewritten profile patch: parse it with the same
 * YAML dialect the loader accepts (!!js passthrough) and assert the preset
 * row still carries every plugin row, with relative names pointing at the
 * preset directory.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire('D:/dsh/package.json')
const yaml = require('js-yaml')

const JsType = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  construct: (data) => ({ __jsExpr: String(data) }),
})
const schema = yaml.DEFAULT_SCHEMA.extend([JsType])

const patchFile = join(process.env.USERPROFILE, '.dsh', 'profiles', 'desktop', 'cordis.patch.yml')
const doc = yaml.load(readFileSync(patchFile, 'utf8'), { schema })

if (!Array.isArray(doc)) throw new Error('patch root is not a list')

const insert = doc.find((row) => row && row.insert)
if (!insert) throw new Error('no insert row')
const presetRow = insert.insert.find((row) => row.id === 'preset-grok-code')
if (!presetRow) throw new Error('preset-grok-code row missing')

const plugins = presetRow.config.plugins
const collect = (rows, out = []) => {
  for (const row of rows) {
    if (!row || typeof row.name !== 'string') throw new Error('plugin row without name')
    out.push(row)
    if (row.group === true) collect(row.config, out)
  }
  return out
}
const all = collect(plugins)

const relative = all.filter((row) => row.name.startsWith('../../.agent-presets/grok-code/'))
const packages = new Set(all.filter((row) => !relative.includes(row)).map((row) => row.name))

console.log('plugin rows:', plugins.length, '| total incl. groups:', all.length)
console.log('relative rows:', relative.length)
console.log('distinct package rows:', packages.size)
console.log('ids present:', ['persona', 'workflow-ptc', 'tool-web', 'official-file-prompt-shadow', 'tool-subagent'].map((id) => {
  const row = all.find((candidate) => candidate.id === id)
  return `${id}=${row ? 'yes' : 'MISSING'}`
}).join(' '))
const shadow = all.find((row) => row.id === 'official-file-prompt-shadow')
console.log('shadow disabled:', shadow.disabled)
const web = all.find((row) => row.id === 'tool-web')
console.log('tool-web fetch:', web.config.fetch)
const sub = all.find((row) => row.id === 'tool-subagent')
console.log('subagent agentPreset:', sub.config.agentPreset)
