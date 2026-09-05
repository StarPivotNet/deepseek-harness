/** Durable product-update cache stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'
import { DESKTOP_UPDATE_PLATFORMS } from './artifact.ts'
import { PRODUCT_CHANNELS, type ProductChannel } from './channel.ts'
import type { ProductRelease } from './releases.ts'

/** Settings namespace owned by the product-update plugin. */
export const PRODUCT_UPDATE_SETTINGS_NAMESPACE = 'product-update'

/** One completed (or reused) check presented to the client. */
export interface ProductCheckResult {
  available: boolean
  currentVersion: string
  latest?: ProductRelease
  checkedAt: number
  channel: ProductChannel
}

/** Durable product-update section shared by the Host schema and the browser scope. */
export interface ProductUpdateSettings {
  lastCheckAt?: number
  lastCheckEtag?: string
  lastCheckBodyHash?: string
  lastResult?: ProductCheckResult
  dismissedTag?: string
}

// schemastery object schemas default to `{}`; `undefined as never` is the
// absent-object sentinel (`default()` is typed as T, not T | undefined).
const ProductReleaseArtifactSchema = z.object({
  name: z.string(),
  url: z.string(),
  sha256: z.string(),
  size: z.number(),
  platform: z.union([...DESKTOP_UPDATE_PLATFORMS]),
}).default(undefined as never)

const ProductReleaseSchema = z.object({
  tag: z.string(),
  version: z.string(),
  url: z.string(),
  notes: z.string(),
  artifact: ProductReleaseArtifactSchema.required(false),
}).default(undefined as never)

/** Durable product-update schema; also the wire envelope the browser scope validates against. */
export const ProductUpdateSettingsSchema: z<ProductUpdateSettings> = z.object({
  lastCheckAt: z.number().required(false),
  lastCheckEtag: z.string().required(false),
  lastCheckBodyHash: z.string().required(false),
  lastResult: z.object({
    available: z.boolean(),
    currentVersion: z.string(),
    latest: ProductReleaseSchema.required(false),
    checkedAt: z.number(),
    channel: z.union([...PRODUCT_CHANNELS]),
  }).default(undefined as never).required(false),
  dismissedTag: z.string().required(false),
})
