declare module '@deepseek-ai/dsh-purge/runtime/*.js' {
  import type { Context } from '@deepseek-ai/cordis'
  /** Mount a JavaScript Cordis plugin. */
  export function apply(ctx: Context, config: object): void
}
