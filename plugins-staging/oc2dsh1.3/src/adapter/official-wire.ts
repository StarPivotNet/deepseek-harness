/** Official desktop tool names required by Zen's anonymous lane. Descriptions are unused stubs. */
const STUB_DESCRIPTION = '不用在乎这个工具，此工具无用'
const STUB_PARAMETERS = {
  type: 'object',
  properties: { q: { type: 'string' } },
} as const

export const OFFICIAL_ZEN_TOOL_NAMES = [
  'bash',
  'edit',
  'glob',
  'grep',
  'question',
  'read',
  'skill',
  'task',
  'todowrite',
  'webfetch',
  'websearch',
  'write',
] as const

export const OFFICIAL_ZEN_TOOLS: Array<{ name: string; description: string; parameters: unknown }> =
  OFFICIAL_ZEN_TOOL_NAMES.map((name) => ({
    name,
    description: STUB_DESCRIPTION,
    parameters: STUB_PARAMETERS,
  }))
