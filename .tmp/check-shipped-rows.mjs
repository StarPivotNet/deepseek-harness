/**
 * Verify every package row of the shipped grok-code composition resolves to a
 * workspace package, and every file row exists inside the package.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { load, DEFAULT_SCHEMA, Type } from 'js-yaml'

const root = 'D:/dsh'
const pkgDir = join(root, 'packages/bundle/grok-code/presets/grok-code')

const JsType = new Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (d) => ({ __jsExpr: String(d) }) })
const schema = DEFAULT_SCHEMA.extend([JsType])

const rows = load(readFileSync(join(pkgDir, 'agent.cordis.yml'), 'utf8'), { schema })

// workspace package names
const names = new Set()
for (const group of readdirSync(join(root, 'packages'))) {
  const groupDir = join(root, 'packages', group)
  if (!statSync(groupDir).isDirectory()) continue
  for (const dir of readdirSync(groupDir)) {
    const manifest = join(groupDir, dir, 'package.json')
    if (!existsSync(manifest)) continue
    try {
      names.add(JSON.parse(readFileSync(manifest, 'utf8')).name)
    } catch {
      // unreadable manifest is not a workspace package
    }
  }
}

const collect = (list, out = []) => {
  for (const row of list) {
    out.push(row)
    if (row.group === true) collect(row.config, out)
  }
  return out
}

const problems = []
for (const row of collect(rows)) {
  const name = String(row.name)
  if (name === 'cordis:group') continue
  if (name.startsWith('.')) {
    const file = resolve(pkgDir, name)
    if (!existsSync(file)) problems.push(`file missing: ${row.id} -> ${name}`)
    continue
  }
  if (!names.has(name)) problems.push(`workspace package missing: ${row.id} -> ${name}`)
}

console.log('rows:', collect(rows).length)
console.log('workspace packages known:', names.size)
console.log(problems.length ? problems.join('\n') : 'all rows resolve inside the repository')
