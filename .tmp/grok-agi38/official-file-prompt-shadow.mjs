/**
 * Shadow the official filesystem read, write, and edit prompt sections.
 *
 * The host tool-fs plugin owns the global `tool:read`, `tool:write`, and
 * `tool:edit` sections. A same-name section registered in this preset
 * scope shadows each one for this preset's agents. Empty text removes the
 * official guidance so dsh-file-tools owns file access. It also
 * shadows the host Web GUI section `app:web-surface`.
 */
export const name = 'official-file-prompt-shadow'
export const inject = ['systemPrompt']

const sections = [
  ['tool:read', 'TOOL_READ'],
  ['tool:write', 'TOOL_WRITE'],
  ['tool:edit', 'TOOL_EDIT'],
  ['app:web-surface', 'WEB_SURFACE'],
]

function registrationScope(ctx) {
  let current = ctx
  while (current != null) {
    const key = Object.getOwnPropertySymbols(current).find((candidate) => String(candidate).includes('dsh.scope'))
    if (key !== undefined) return current[key]
    current = Object.getPrototypeOf(current)
  }
}

function currentLayer(prompt) {
  const scope = registrationScope(prompt.ctx)
  return scope === undefined ? prompt.layers.global : prompt.layers.peek(scope)
}

export function registerSection(prompt, section) {
  try {
    return prompt.section(section)
  } catch (error) {
    if (!String(error?.message).includes(`prompt section "${section.name}" is already registered`)) throw error
    const existing = currentLayer(prompt)?.sections.data.get(section.name)
    if (existing === undefined) throw error
    existing.order = section.order
    existing.text = section.text
  }
}

export function apply(ctx) {
  const prompt = ctx.systemPrompt
  for (const [name, order] of sections) {
    registerSection(prompt, {
      name,
      order: prompt.getSectionOrder(order),
      text: '',
    })
  }
}
