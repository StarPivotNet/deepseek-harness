/** V5 headers with the existing physical row framing and tool-role event admission. */
import { SessionFormatError, isSessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatCodec, SessionFormatCurrentEncoder } from '@deepseek-ai/dsh-session-format'
import { releasedV2SessionFormatCodec } from '@deepseek-ai/dsh-session-format-v2-to-v3'
import { assertReleasedV5Header, assertV5RowAdmission } from './validation.ts'

function physicalHeader(value: unknown) {
  if (!isSessionFormatJsonObject(value) || value['version'] !== 5) throw new SessionFormatError('expected format v5 physical header')
  return { ...value, version: 2 }
}

/** V5 preserves V2 physical framing and admits current headers and producer attribution. */
export const releasedV5SessionFormatCodec = Object.freeze({
  version: 5,
  decodeHeader(value: unknown) {
    const header = { ...releasedV2SessionFormatCodec.decodeHeader(physicalHeader(value)), version: 5 }
    assertReleasedV5Header(header)
    return header
  },
  createDecoder(value, recovery) {
    const decoder = releasedV2SessionFormatCodec.createDecoder(physicalHeader(value), recovery)
    const header = { ...decoder.header, version: 5 }
    assertReleasedV5Header(header)
    return { ...decoder, header, decodeRow(row, context) {
      assertV5RowAdmission(row)
      decoder.decodeRow(row, context)
    } }
  },
  encodeHeader(header, inheritedEventCount) {
    assertReleasedV5Header(header)
    return { ...releasedV2SessionFormatCodec.encodeHeader({ ...header, version: 2 }, inheritedEventCount), version: 5 }
  },
  encodeEvent(event) {
    assertV5RowAdmission(event, new Set(['developer/message']))
    return releasedV2SessionFormatCodec.encodeEvent(event)
  },
} satisfies SessionFormatCodec & SessionFormatCurrentEncoder)
