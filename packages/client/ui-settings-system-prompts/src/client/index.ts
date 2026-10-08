/**
 * System-prompt settings surface, browser half — one section over the user
 * library and per-model assemblies stored in `user-system-prompts`.
 */

import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { SystemPromptsSection } from './SystemPromptsSection.tsx'
import type { SystemPromptsSectionInjected } from './SystemPromptsSection.tsx'
import { en, zh, type SystemPromptsKey } from './locales.ts'
import { refreshIfLoaded, SystemPromptsStore, USER_SYSTEM_PROMPTS_NS } from './store.ts'

export type { SystemPromptsSectionInjected, SystemPromptsSectionProps } from './SystemPromptsSection.tsx'
export type { SystemPromptsKey } from './locales.ts'
export type {
  BindingRow, BuiltInRow, CatalogModel, OverrideRow, PromptDraft, PromptRow, SystemPromptsState,
} from './store.ts'
export { USER_SYSTEM_PROMPTS_NS, bindingFor, slugFromName } from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The System prompts settings page. */
    'settings.systemPrompts': SystemPromptsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.systemPrompts'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'connection', 'remote', 'remote.settings', 'remote.llm', 'remote.systemPrompt']

/**
 * Register the System prompts section once `settings.section` is declared.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-system-prompts: dictionaries')

  const controller = new SystemPromptsStore(ctx.remote as never)
  const t = ctx.locale.bind(NS)
  const injected = (): SystemPromptsSectionInjected => ({
    hooks: { systemPrompts: controller.store },
    load: () => controller.load(),
    beginCreate: () => { controller.beginCreate() },
    beginEdit: (id: string) => { controller.beginEdit(id) },
    beginEditBuiltIn: (name: string) => { controller.beginEditBuiltIn(name) },
    resetBuiltIn: (name: string) => controller.resetBuiltIn(name),
    cancelDraft: () => { controller.cancelDraft() },
    setDraftName: (name: string) => { controller.setDraftName(name) },
    setDraftText: (text: string) => { controller.setDraftText(text) },
    saveDraft: () => controller.saveDraft(),
    confirmDelete: (id: string | null) => { controller.confirmDelete(id) },
    remove: () => controller.remove(),
    setPromptIds: (provider, model, promptIds) => controller.setPromptIds(provider, model, promptIds),
    setOverride: (provider, model, override) => controller.setOverride(provider, model, override),
  })

  ctx.effect(() => {
    const refresh = (): void => { refreshIfLoaded(controller) }
    const disposers = [
      ctx.remote.$on('settings/document-updated', (ns) => {
        if (ns !== USER_SYSTEM_PROMPTS_NS) return
        refresh()
      }),
      ctx.remote.$on('llm/adapters-updated', refresh),
      ctx.on('connection/reset', refresh),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-settings-system-prompts: pushed invalidations')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'system-prompts',
    order: 25,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, SystemPromptsSection))
}
