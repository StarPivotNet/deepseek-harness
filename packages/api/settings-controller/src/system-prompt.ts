/** Host Remote owner for the deployment-wide system-prompt registry listing. */

import { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

import type { SystemPromptListValue } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    systemPromptCatalog: SystemPromptCatalog
  }
}

/** Host service backing ctx.remote.systemPrompt. */
export class SystemPromptCatalog extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'systemPromptCatalog', { namespace: 'systemPrompt' })
  }

  /**
   * List every contributed system-prompt section for the Settings page.
   * @returns the section inventory the composed system-prompt registry owns.
   * @throws a RemoteError when the composition has no system-prompt registry.
   */
  @Remote('list')
  list(): SystemPromptListValue {
    const systemPrompt = this.ctx.get('systemPrompt')
    if (systemPrompt === undefined) {
      throw new RemoteError(
        'gateway/internal',
        'system-prompt registry is absent: this composition does not mount @deepseek-ai/dsh-system-prompt',
        {},
      )
    }
    return { sections: systemPrompt.listSections() }
  }
}

export default SystemPromptCatalog
