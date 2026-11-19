/**
 * Wire protocol of the `pluginEvents/follow` Remote stream, shared by both faces. Each stream generation opens with
 * one `baseline` frame holding the complete graph, including each row's synced configuration, followed by increments.
 */
import type { WebBootGraph } from '@deepseek-ai/dsh-client-modules/types'

/** Complete state opening every stream generation. */
export interface PluginsEventBaseline {
  type: 'baseline'
  /** Current Web client graph. */
  graph: WebBootGraph
}

/** One increment after the baseline. */
export type PluginsEventIncrement =
  /** The graph after a structural or synced configuration change. */
  | { type: 'graph'; graph: WebBootGraph }
  /** One rebuilt bundle; the page applies it only while its automatic reload preference is on. */
  | { type: 'rebuilt'; id: string; rev: string }
  /** One Host-initiated reload from the manual reload route; the page applies it regardless of that preference. */
  | { type: 'reload'; id: string; rev: string }

/** Every frame of the stream. */
export type PluginsEventFrame = PluginsEventBaseline | PluginsEventIncrement
