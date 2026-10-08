/** Lossless adjacent V4-to-V5 migration; V4 delivery coordinates remain historical. */
import { defineSessionFormatMigration, SessionFormatError, sessionFormatCount, isSessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'
import { assertReleasedV4Header, assertReleasedV4Relationships } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import type { SessionFormatEvent } from '@deepseek-ai/dsh-session-format'
import { assertReleasedV5Header } from './validation.ts'

/** Preserve V4 events and inherited coordinates while advancing the header version. */
export const sessionFormatV4ToV5 = defineSessionFormatMigration({
  name: '@deepseek-ai/dsh-session-format-v4-to-v5',
  fromVersion: 4,
  toVersion: 5,
  migrateHeader(header) {
    assertReleasedV4Header(header)
    return { ...header, version: 5 }
  },
  validateTargetHeader: assertReleasedV5Header,
  createStage(input) {
    const events: SessionFormatEvent[] = []
    let cut = input.sourceInheritedEventCount
    return {
      ...(cut === undefined ? {} : { headerInheritedEventCount: cut }),
      transformEvent(event, context) {
        if (event.type === 'session-log-deepseek/delivery-accepted') {
          if (isSessionFormatJsonObject(event.data)
            && event.data['sessionFormatVersion'] === 5) throw new SessionFormatError('format v4 delivery marker claims target format v5')
          events.push(event)
        }
        if (event.type === 'session/end-seed' && isSessionFormatJsonObject(event.data) && event.data['inherited'] === true) cut = event.seq
        context.emitEvent(event)
      },
      transformRun(run, context) {
        for (const event of run.expand()) this.transformEvent(event, context)
      },
      finish() {
        const inheritedEventCount = sessionFormatCount(cut ?? (input.sourceHeader.isSeeded ? undefined : 0), 'V4 inherited event count')
        assertReleasedV4Relationships({ header: input.sourceHeader, events, inheritedEventCount }, new Set(['session-log-deepseek/delivery-accepted']))
        return inheritedEventCount
      },
    }
  },
})
