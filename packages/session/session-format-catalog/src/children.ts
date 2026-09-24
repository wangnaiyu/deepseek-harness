/** Bind parent-specific child evidence into the static first-party migration inventory. */

import { createSessionFormatCatalog } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatCatalog, SessionFormatJsonValue } from '@deepseek-ai/dsh-session-format'
import { createSessionFormatV3ToV4, sessionFormatV3ToV4 } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { createLegacyPtoV4ToV5, legacyPtoV3ToV4, ptoV4SessionFormatCodec, sessionFormatV4ToV5 } from '@deepseek-ai/dsh-session-format-v4-to-v5'
import { sessionFormatCatalogOptions } from './generated.ts'

/**
 * Assemble a catalog whose V3→V4 edge knows one parent's historical children.
 * @param children - complete child evidence retained unchanged for the catalog's lifetime; an empty array declares no children.
 * @param legacyPtoV4 - true only for a corpus written by the PTO fork before its upstream V4 upgrade.
 * @returns a catalog with independent restore state per artifact and unchanged current-format readers.
 */
export function createSessionFormatCatalogWithChildren(children: readonly SessionFormatJsonValue[],
  legacyPtoV4 = false): SessionFormatCatalog {
  const migration = createSessionFormatV3ToV4(children)
  return createSessionFormatCatalog({
    ...sessionFormatCatalogOptions,
    codecs: sessionFormatCatalogOptions.codecs.map(codec => legacyPtoV4 && codec.version === 4 ? ptoV4SessionFormatCodec : codec),
    migrations: sessionFormatCatalogOptions.migrations.map((edge) => {
      if (edge === sessionFormatV3ToV4) return legacyPtoV4 ? legacyPtoV3ToV4 : migration
      if (edge === sessionFormatV4ToV5 && legacyPtoV4) return createLegacyPtoV4ToV5(children)
      return edge
    }),
  })
}
