/**
 * Check that the shipped redteam composition reader (the mature parser the
 * repo already ships for presets declared from a directory) accepts the
 * grok-code composition unchanged. Reuse instead of writing a second parser.
 */
import { readPresetDefinition } from '../packages/bundle/redteam/runtime/preset-composition.js'

const dir = process.env.USERPROFILE + '\\.dsh\\.agent-presets\\grok-code'

const definition = readPresetDefinition('grok-code', dir)
console.log('id:', definition.id)
console.log('name:', definition.name)
console.log('order:', definition.order)
console.log('rows:', definition.plugins.length)

const collect = (rows, out = []) => {
  for (const row of rows) {
    out.push(row)
    if (row.group === true) collect(row.config, out)
  }
  return out
}
const all = collect(definition.plugins)
console.log('rows incl groups:', all.length)

const files = all.filter((row) => row.name.startsWith('file:'))
const packages = all.filter((row) => !row.name.startsWith('file:') && row.name !== 'cordis:group')
console.log('file rows:', files.length)
console.log('package rows:', packages.length)
console.log('sample file row:', files[0]?.name)
console.log('js expr rows:', all.filter((row) => row.disabled && typeof row.disabled === 'object').length)
