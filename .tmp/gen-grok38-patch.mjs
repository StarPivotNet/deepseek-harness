import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const home = process.env.USERPROFILE
const presetDir = join(home, '.dsh', '.agent-presets', 'grok-code')
const patchFile = join(home, '.dsh', 'profiles', 'desktop', 'cordis.patch.yml')

const yml = readFileSync(join(presetDir, 'agent.cordis.yml'), 'utf8').replace(/\r\n/g, '\n')
const lines = yml.split('\n')

const INDENT = ' '.repeat(10)
let body = lines.map((line) => (line.length ? INDENT + line : line)).join('\n')

// A relative row name resolves against the DECLARING loader (the profile patch),
// so rewrite ./x to the preset directory relative to the profile directory.
const prefix = '../../.agent-presets/grok-code/'
let rewrites = 0
body = body.replace(/^(\s*-?\s*name:\s*)(\.\/\S+)\s*$/gm, (_, head, spec) => {
  rewrites += 1
  return `${head}${prefix}${spec.slice(2)}`
})

const block = `        plugins:\n${body.trimEnd()}\n`

const parent = readFileSync(patchFile, 'utf8')
const start = parent.indexOf('        plugins:\n')
if (start < 0) throw new Error('plugins: header not found in profile patch')
const endMarker = '\n- id: permission\n'
const end = parent.indexOf(endMarker, start)
if (end < 0) throw new Error('permission row not found after the preset block')

const next = parent.slice(0, start) + block + parent.slice(end + 1)
writeFileSync(patchFile, next, 'utf8')

console.log('relative rewrites:', rewrites)
console.log('block lines:', block.split('\n').length)
console.log('patch lines: before', parent.split('\n').length, 'after', next.split('\n').length)
