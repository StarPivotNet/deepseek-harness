# Agent Note: Omit the default image side-length admission cap

Status: implemented

English | [中文](2026-08-27-omit-default-image-side-admission-cap.zh.md)

## Problem

Source admission refused any image whose width or height exceeded a default per-side pixel cap. Ordinary screenshots and photographs then failed in the composer with copy that named that cap, even though later normalization already limited the stored long edge and each model route already projected its own request version. The earlier 2000px default existed to keep durable history inside a many-image provider bound; after independent normalization, that refusal no longer protected later requests and blocked ordinary large sources.

## Decision

The local attachment backend omits `maxImageDimension` unless a deployment sets it. Source admission still fully decodes under the configured byte and decoded-pixel limits, then normalizes the stored long edge. `IMAGE_DIMENSION_TOO_LARGE` remains a configured-cap failure: `read_image` and Web copy name the configured side length when present, and otherwise fall back to a generic send-failed or downscale line. The `imageLimits` projection and wire schema treat the field as optional so clients do not invent a default.

This decision lives beside [Unified normalized attachments, request versions, and provider files](../../archived/feature/2026-08-20-unified-image-request-pipeline.md), which still owns the two-version image path. That note's source-admission facts now match this omission.

## Alternatives considered

**Keep an 8192px default.** That still refuses panoramic and high-resolution sources before normalization, recreating the composer toast the user asked to remove.

**Delete the configured cap and error code.** Deployments that still need a hard side-length refusal, and `read_image` tests that exercise it, would lose a named recovery path.

**Downscale at admission instead of refusing when a cap is set.** A configured cap is an explicit refusal. Normalization already downscales the stored image; mixing silent resize into the refusal path would hide the deployment choice.

## Consequences

Ordinary large sources reach normalization and later request projection instead of failing in the composer. A deployment that still needs a side-length refusal must set `maxImageDimension` explicitly. Historical objects admitted under an older default remain valid; only new admissions change.
