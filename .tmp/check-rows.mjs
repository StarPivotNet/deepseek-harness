/**
 * Resolve every plugin row in the rewritten profile patch the way the preset
 * roster does: package rows must exist in the installed harness, relative
 * rows must exist on disk.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire('D:/dsh/package.json')
const yaml = require('js-yaml')

const JsType = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  construct: (data) => ({ __jsExpr: String(data) }),
})
const schema = yaml.DEFAULT_SCHEMA.extend([JsType])

const patchFile = join(process.env.USERPROFILE, '.dsh', 'profiles', 'desktop', 'cordis.patch.yml')
const doc = yaml.load(readFileSync(patchFile, 'utf8'), { schema })
const presetRow = doc.find((row) => row && row.insert).insert.find((row) => row.id === 'preset-grok-code')

const collect = (rows, out = []) => {
  for (const row of rows) {
    out.push(row)
    if (row.group === true) collect(row.config, out)
  }
  return out
}
const all = collect(presetRow.config.plugins)

// Installed harness package set, read from the asar header.
const asar = 'C:\\Users\\Administrator\\AppData\\Local\\Programs\\DeepSeekHarness\\resources\\app.asar'
const buf = readFileSync(asar)
const headerSize = buf.readUInt32LE(4)
const jsonLen = buf.readUInt32LE(12)
const header = JSON.parse(buf.slice(16, 16 + jsonLen).toString('utf8'))
const installed = new Set()
;(function walk(node, prefix) {
  for (const key of Object.keys(node.files || {})) {
    const child = node.files[key]
    const path = `${prefix}/${key}`
    if (child.files) walk(child, path)
    else {
      const match = /^\/dsh\/node_modules\/(@deepseek-ai\/[^/]+|@[^/]+\/[^/]+|[^@/][^/]*)\/package.json$/.exec(path)
      if (match) installed.add(match[1])
    }
  }
})(header, '')

// Profile-installed packages resolve from the profile's node_modules.
const profileModules = join(process.env.USERPROFILE, '.dsh', 'profiles', 'desktop', 'node_modules')
const profileInstalled = (name) => {
  const pkg = name.split('/').slice(0, name.startsWith('@') ? 2 : 1).join('/')
  return existsSync(join(profileModules, pkg, 'package.json'))
}

const presetDir = join(process.env.USERPROFILE, '.dsh', '.agent-presets', 'grok-code')
const profileDir = dirname(patchFile)

const problems = []
for (const row of all) {
  const name = row.name
  if (name.startsWith('../../.agent-presets/grok-code/')) {
    const file = join(profileDir, name)
    if (!existsSync(file)) problems.push(`MISSING FILE  ${row.id}: ${name}`)
    continue
  }
  if (name.startsWith('.')) {
    problems.push(`UNREWRITTEN   ${row.id}: ${name}`)
    continue
  }
  if (name === 'cordis:group') continue
  const pkg = name.split('/').slice(0, name.startsWith('@') ? 2 : 1).join('/')
  if (!installed.has(pkg) && !profileInstalled(name)) problems.push(`MISSING PKG   ${row.id}: ${name}`)
}

console.log('rows checked:', all.length)
console.log(problems.length ? problems.join('\n') : 'all rows resolve')
