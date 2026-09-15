/** V3-to-V4 framing and identity migration for PTO analysis source metadata. */
import {
  defineSessionFormatMigration, isSessionFormatJsonObject, SessionFormatError, snapshotSessionFormatJson,
} from '@deepseek-ai/dsh-session-format'
import type {
  SessionFormatArtifact, SessionFormatCodec, SessionFormatCurrentEncoder, SessionFormatEvent,
  SessionFormatHeader,
} from '@deepseek-ai/dsh-session-format'
import {
  assertReleasedV3Header, releasedV3SessionFormatCodec, restoreReleasedV3Artifact,
} from '@deepseek-ai/dsh-session-format-v2-to-v3'

export { releasedV3SessionFormatCodec } from '@deepseek-ai/dsh-session-format-v2-to-v3'

/**
 * Validate V4 metadata with the unchanged V3 fields.
 * @param header - logical V4 header.
 */
export function assertPtoV4Header(header: SessionFormatHeader): void {
  if (header.version !== 4) throw new SessionFormatError('expected format v4 header')
  assertReleasedV3Header({ ...header, version: 3 })
}

function sourceHeader(value: unknown): SessionFormatHeader {
  const header = snapshotSessionFormatJson(value, 'format v4 physical header')
  if (!isSessionFormatJsonObject(header) || header['version'] !== 4) {
    throw new SessionFormatError('expected format v4 physical header')
  }
  return { ...header, version: 3 } as SessionFormatHeader
}

/** V4 retains V3 physical framing and event admission, with a distinct writer header. */
export const ptoV4SessionFormatCodec = Object.freeze({
  version: 4,
  decodeHeader(value: unknown) {
    return { ...releasedV3SessionFormatCodec.decodeHeader(sourceHeader(value)), version: 4 }
  },
  createDecoder(value, recovery) {
    const decoder = releasedV3SessionFormatCodec.createDecoder(sourceHeader(value), recovery)
    return {
      ...decoder,
      header: { ...decoder.header, version: 4 },
      decodeRow: decoder.decodeRow.bind(decoder),
      finish: decoder.finish.bind(decoder),
    }
  },
  encodeHeader(header, inheritedEventCount) {
    assertPtoV4Header(header)
    return { ...releasedV3SessionFormatCodec.encodeHeader({ ...header, version: 3 }, inheritedEventCount), version: 4 }
  },
  encodeEvent: releasedV3SessionFormatCodec.encodeEvent,
} satisfies SessionFormatCodec & SessionFormatCurrentEncoder)

/**
 * Validate unchanged V3 relationships while retaining the original V4 artifact.
 * @param artifact - detached V4 artifact.
 * @param knownEventTypes - installed event vocabulary for required-event admission.
 * @returns the same validated artifact without changing its event data.
 */
export function restorePtoV4Artifact(artifact: SessionFormatArtifact, knownEventTypes: ReadonlySet<string>): SessionFormatArtifact {
  assertPtoV4Header(artifact.header)
  restoreReleasedV3Artifact({ ...artifact, header: { ...artifact.header, version: 3 } }, knownEventTypes)
  return artifact
}

/** Identity body edge: preserve event positions, source metadata, compact runs and inherited cuts. */
export const sessionFormatV3ToV4 = defineSessionFormatMigration({
  name: '@deepseek-ai/dsh-session-format-v3-to-v4',
  fromVersion: 3,
  toVersion: 4,
  migrateHeader(header) {
    assertReleasedV3Header(header)
    return { ...header, version: 4 }
  },
  validateTargetHeader: assertPtoV4Header,
  createStage(input) {
    assertReleasedV3Header(input.sourceHeader)
    let cut = input.sourceInheritedEventCount ?? (input.sourceHeader.isSeeded ? undefined : 0)
    const observe = (event: SessionFormatEvent): void => {
      if (event.type === 'session/end-seed' && isSessionFormatJsonObject(event.data)
        && event.data['inherited'] === true) cut = event.seq
    }
    return {
      ...cut === undefined ? {} : { headerInheritedEventCount: cut },
      transformEvent(event, context) { observe(event); context.emitEvent(event) },
      transformRun(run, context) {
        // V3 compact runs contain Assistant stream events, never seed markers.
        context.emitRun(run)
      },
      finish() {
        if (cut === undefined) throw new SessionFormatError('format v3 seeded Session lacks an inherited cut')
        return cut
      },
    }
  },
})
