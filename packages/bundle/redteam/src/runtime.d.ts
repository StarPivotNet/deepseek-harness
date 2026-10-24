declare module '@deepseek-ai/dsh-redteam/runtime/index.js' {
  import type { Context } from '@deepseek-ai/cordis'
  export const name: string
  export const inject: string[]
  export function apply(ctx: Context, config?: object): void
}
declare module '@deepseek-ai/dsh-redteam/runtime/store.js' {
  import type { Context } from '@deepseek-ai/cordis'
  export const name: string
  export const inject: string[]
  export function apply(ctx: Context, config?: object): void
}
declare module '@deepseek-ai/dsh-redteam/runtime/tools.js' {
  import type { Context } from '@deepseek-ai/cordis'
  export const name: string
  export const inject: string[]
  export function apply(ctx: Context, config?: object): void
}
declare module '@deepseek-ai/dsh-redteam/runtime/ui.js' {
  import type { Context } from '@deepseek-ai/cordis'
  export const name: string
  export const inject: string[]
  export function apply(ctx: Context, config?: object): void
}
declare module '@deepseek-ai/dsh-redteam/runtime/preset-composition.js' {
  export function readPresetDefinition(id: string, dir: string): {
    id: string
    plugins: { name?: string }[]
  }
  export function readCompositionRows(text: string, dir: string): unknown[]
  export class CompositionError extends Error {}
}
