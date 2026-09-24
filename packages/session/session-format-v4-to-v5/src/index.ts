/** V5 separates the current writer from the two historical V4 lineages. */
import { defineSessionFormatMigration, isSessionFormatJsonObject, SessionFormatError } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatArtifact, SessionFormatCodec, SessionFormatCurrentEncoder, SessionFormatHeader, SessionFormatJsonValue, SessionFormatMigration } from '@deepseek-ai/dsh-session-format'
import { assertReleasedV4Header, assertReleasedV4Relationships, createSessionFormatV3ToV4, releasedV4SessionFormatCodec, restoreReleasedV4Artifact } from '@deepseek-ai/dsh-session-format-v3-to-v4'
export { releasedV4SessionFormatCodec } from '@deepseek-ai/dsh-session-format-v3-to-v4'
export { legacyPtoV3ToV4, ptoV4SessionFormatCodec, restorePtoV4Artifact, assertPtoV4Header } from './legacy.ts'

/** Validate V5 metadata against the unchanged upstream V4 fields.
 * @param header - logical V5 metadata.
 */
export function assertPtoV5Header(header: SessionFormatHeader): void {
  if (header.version !== 5) throw new SessionFormatError('expected PTO format v5 header')
  assertReleasedV4Header({ ...header, version: 4 })
}

function v4Header(value: unknown): SessionFormatHeader {
  if (!isSessionFormatJsonObject(value) || value['version'] !== 5) throw new SessionFormatError('expected PTO format v5 physical header')
  return { ...value, version: 4 } as SessionFormatHeader
}

/** V5 uses upstream V4 physical framing and message admission. */
export const ptoV5SessionFormatCodec = Object.freeze({
  version: 5,
  decodeHeader(value: unknown) { return { ...releasedV4SessionFormatCodec.decodeHeader(v4Header(value)), version: 5 } },
  createDecoder(value, recovery) {
    const decoder = releasedV4SessionFormatCodec.createDecoder(v4Header(value), recovery)
    return { ...decoder,
      header: { ...decoder.header,
        version: 5 },
      decodeRow: decoder.decodeRow.bind(decoder),
      finish: decoder.finish.bind(decoder) }
  },
  encodeHeader(header, inheritedEventCount) {
    assertPtoV5Header(header)
    return { ...releasedV4SessionFormatCodec.encodeHeader({ ...header, version: 4 }, inheritedEventCount), version: 5 }
  },
  encodeEvent: releasedV4SessionFormatCodec.encodeEvent,
} satisfies SessionFormatCodec & SessionFormatCurrentEncoder)

/** Validate V5 relationships with delivery acknowledgements scoped to their generation.
 * @param artifact - detached V5 artifact.
 * @param knownEventTypes - installed required-event vocabulary.
 * @returns the original artifact after validation.
 */
export function restorePtoV5Artifact(artifact: SessionFormatArtifact, knownEventTypes: ReadonlySet<string>): SessionFormatArtifact {
  assertPtoV5Header(artifact.header)
  restoreReleasedV4Artifact(asV4Artifact(artifact), knownEventTypes)
  return artifact
}

/** Official V4 bodies retain their events and inherited coordinates in V5. */
export const sessionFormatV4ToV5 = defineSessionFormatMigration({
  name: '@deepseek-ai/dsh-session-format-v4-to-v5', fromVersion: 4, toVersion: 5,
  migrateHeader(header) { assertReleasedV4Header(header); return { ...header, version: 5 } },
  validateTargetHeader: assertPtoV5Header,
  createStage(input) {
    let cut = input.sourceInheritedEventCount ?? (input.sourceHeader.isSeeded ? undefined : 0)
    return {
      ...cut === undefined ? {} : { headerInheritedEventCount: cut },
      transformEvent(event, context) {
        if (event.type === 'session-log-deepseek/delivery-accepted' && isSessionFormatJsonObject(event.data) && event.data['sessionFormatVersion'] === 5) throw new SessionFormatError('V4 delivery marker claims target format V5')
        if (event.type === 'session/end-seed' && isSessionFormatJsonObject(event.data) && event.data['inherited'] === true) cut = event.seq
        context.emitEvent(event)
      },
      transformRun(run, context) { context.emitRun(run) },
      finish() { if (cut === undefined) throw new SessionFormatError('seeded V4 Session lacks inherited cut'); return cut },
    }
  },
})

/** Bind the explicitly selected PTO V4 lineage to upstream's complete V3 body converter.
 * @param children - complete historical child evidence, including an empty array for no children.
 * @returns adjacent PTO V4 to V5 migration; never selected by guessing event contents.
 */
export function createLegacyPtoV4ToV5(children: readonly SessionFormatJsonValue[]): SessionFormatMigration {
  const upstream = createSessionFormatV3ToV4(children)
  return defineSessionFormatMigration({
    ...sessionFormatV4ToV5,
    createStage(input) {
      const stage = upstream.createStage({ ...input,
        sourceHeader: { ...input.sourceHeader,
          version: 3 },
        targetHeader: { ...input.targetHeader,
          version: 4 } })
      return {
        ...stage.headerInheritedEventCount === undefined ? {} : { headerInheritedEventCount: stage.headerInheritedEventCount },
        transformEvent(event, context) {
          // Legacy PTO acknowledgements used V4 coordinates over V3 bodies.
          if (event.type === 'session-log-deepseek/delivery-accepted' && isSessionFormatJsonObject(event.data) && event.data['sessionFormatVersion'] === 4) {
            stage.transformEvent({ ...event, data: { ...event.data, sessionFormatVersion: 3 } }, context)
          } else stage.transformEvent(event, context)
        },
        transformRun: stage.transformRun.bind(stage), finish: stage.finish.bind(stage),
      }
    },
  })
}

function asV4Artifact(artifact: SessionFormatArtifact): SessionFormatArtifact {
  const events = artifact.events.map((event) => {
    if (event.type !== 'session-log-deepseek/delivery-accepted' || !isSessionFormatJsonObject(event.data)) return event
    const version = event.data['sessionFormatVersion']
    if (version !== 5) return event
    return { ...event, data: { ...event.data, sessionFormatVersion: 4 } }
  })
  return { ...artifact, header: { ...artifact.header, version: 4 }, events }
}

/** Validate native V5 delivery, catalog and message relationships after tail recovery.
 * @param artifact - decoded current artifact.
 * @param knownEventTypes - installed event vocabulary.
 */
export function assertPtoV5Relationships(artifact: SessionFormatArtifact, knownEventTypes: ReadonlySet<string>): void {
  assertReleasedV4Relationships(asV4Artifact(artifact), knownEventTypes)
}
