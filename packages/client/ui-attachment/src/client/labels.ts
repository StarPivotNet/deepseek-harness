import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { AttachmentRailLabels } from '../AttachmentRail.tsx'
import type { DropOverlayLabels } from '../DropOverlay.tsx'
import type { FileCardLabels } from '../FileCard.tsx'
import type { ImageLightboxLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MessageImageLabels } from '../MessageImage.tsx'
import type { MessageVideoLabels } from '../MessageVideo.tsx'

/**
 * Resolve original-image lightbox strings from the conversation namespace.
 * @param t - conversation namespace translator.
 * @returns translated lightbox labels.
 */
export function lightboxLabels(t: TranslateNS<'conversation'>): ImageLightboxLabels {
  return { dialog: t('image.preview'), close: t('image.closePreview') }
}

/**
 * Resolve historical message-image strings from the conversation namespace.
 * @param t - conversation namespace translator.
 * @returns translated message-image labels.
 */
export function messageImageLabels(t: TranslateNS<'conversation'>): MessageImageLabels {
  return {
    image: t('image.label'),
    open: t('image.openOriginal'),
    openNamed: label => t('image.openOriginalLabel', { label }),
    loading: t('image.loading'),
    loadFailed: t('image.loadFailed'),
    lightbox: lightboxLabels(t),
  }
}

/**
 * Resolve historical message-video strings from the conversation namespace.
 * @param t - conversation namespace translator.
 * @returns translated message-video labels.
 */
export function messageVideoLabels(t: TranslateNS<'conversation'>): MessageVideoLabels {
  return {
    video: t('video.label'),
    loading: t('video.loading'),
    loadFailed: t('video.loadFailed'),
  }
}

/**
 * Resolve the document-level drop invitation and its optional limits lines.
 * @param t - conversation namespace translator.
 * @param accepting - whether the composer can accept dropped files.
 * @param limits - optional translated image/attachment count and size values.
 * @param videoLimits - optional translated video count and size values.
 * @returns translated drop-overlay labels.
 */
export function dropOverlayLabels(
  t: TranslateNS<'conversation'>,
  accepting: boolean,
  limits?: { readonly count: number; readonly size: string },
  videoLimits?: { readonly count: number; readonly size: string },
): DropOverlayLabels {
  if (!accepting) return { title: t('attachment.dropBlocked') }
  const lines = [
    limits === undefined ? undefined : t('attachment.dropDesc', limits),
    videoLimits === undefined ? undefined : t('video.dropDesc', videoLimits),
  ].filter((line): line is string => line !== undefined)
  return {
    title: t('attachment.dropTitle'),
    desc: lines.length === 0 ? undefined : lines.join(' · '),
  }
}

/**
 * Resolve pending-file card strings from the conversation namespace.
 * @param t - conversation namespace translator.
 * @param name - browser file name interpolated into remove/retry labels.
 * @returns translated file-card labels.
 */
export function fileCardLabels(t: TranslateNS<'conversation'>, name: string): FileCardLabels {
  return {
    label: t('file.pending'),
    remove: t('file.remove', { name }),
    uploading: t('file.uploading'),
    failed: t('file.uploadFailed'),
    retry: t('file.retry', { name }),
  }
}

/**
 * Resolve the mixed draft-attachment rail strings from the conversation namespace.
 * @param t - conversation namespace translator.
 * @returns translated attachment-rail labels.
 */
export function attachmentRailLabels(t: TranslateNS<'conversation'>): AttachmentRailLabels {
  return {
    group: t('attachment.pending'),
    scrollLeft: t('attachment.scrollLeft'),
    scrollRight: t('attachment.scrollRight'),
  }
}

/**
 * Resolve draft-video rail strings from the conversation namespace.
 * @param t - conversation namespace translator.
 * @returns translated attachment-rail labels.
 */
export function videoRailLabels(t: TranslateNS<'conversation'>): AttachmentRailLabels {
  return {
    group: t('video.pending'),
    scrollLeft: t('video.scrollLeft'),
    scrollRight: t('video.scrollRight'),
  }
}
