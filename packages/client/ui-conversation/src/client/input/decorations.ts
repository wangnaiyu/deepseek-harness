/**
 * Plain-text reference scan (the plain-text-reference decision;
 * see .agents/notes/implemented/architecture/2026-07-25-web-input-machine-and-slash-pipeline.md):
 * a `/name` or `@name` token whose name is on the trigger's lexicon, and
 * syntax-recognizable `@dir/` folder tokens. Pure derivation — the editor's
 * text-ref entity transform consumes these ranges; editing the text out of
 * match shape simply drops the range next scan.
 */

/**
 * One plain-text reference range (the plain-text-reference decision;
 * see .agents/notes/implemented/architecture/2026-07-25-web-input-machine-and-slash-pipeline.md):
 * a `/<lexeme>` or `@<lexeme>` token
 * whose post-trigger lexeme is on the trigger's lexicon. Lexemes may contain
 * spaces (for example `skill analyze`). Pure derivation — editing the text
 * out of match shape simply drops the range next scan.
 */
export interface TextRefRange {
  readonly start: number
  readonly end: number
  readonly trigger: '/' | '@'
}

/** Trigger matcher: a trigger char at draft start or immediately after whitespace. */
const TEXT_REF_RE = /(^|\s)([/@])/g
const FOLDER_REF_RE = /(^|\s)(@(?:"[^"\n]*\/|[^\s"]+\/))/g

/**
 * Scan the draft for plain-text reference tokens against the hot lexicons.
 * Word-boundary discipline: the trigger must sit at the draft
 * start or after whitespace ('x/name' never matches); the text after the
 * trigger must be an exact lexicon member followed by whitespace or EOF.
 * Longest matches win, allowing canonical multi-token forms such as
 * `/skill analyze` to coexist with a single-token `skill` lexeme.
 * @param draft - draft text.
 * @param lexicon - per-trigger name lists (a missing trigger scans nothing).
 * @returns matched ranges in draft order.
 */
export function scanTextRefs(
  draft: string, lexicon: ReadonlyMap<'/' | '@', readonly string[]>,
): TextRefRange[] {
  if (draft === '') return []
  const out: TextRefRange[] = []
  if (lexicon.size > 0) {
    TEXT_REF_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = TEXT_REF_RE.exec(draft)) !== null) {
      const trigger = m[2] as '/' | '@'
      const names = lexicon.get(trigger)
      if (names === undefined) continue
      const start = m.index + (m[1]?.length ?? 0)
      const contentStart = start + 1
      const name = [...new Set(names)]
        .filter(candidate => candidate.length > 0)
        .sort((left, right) => right.length - left.length)
        .find((candidate) => {
          if (!draft.startsWith(candidate, contentStart)) return false
          const next = draft[contentStart + candidate.length]
          return next === undefined || /\s/u.test(next)
        })
      if (name !== undefined) out.push({ start, end: contentStart + name.length, trigger })
    }
  }
  FOLDER_REF_RE.lastIndex = 0
  let folder: RegExpExecArray | null
  while ((folder = FOLDER_REF_RE.exec(draft)) !== null) {
    const token = folder[2] ?? ''
    const start = folder.index + (folder[1]?.length ?? 0)
    const end = start + token.length
    if (!out.some(range => range.start < end && range.end > start)) {
      out.push({ start, end, trigger: '@' })
    }
  }
  return out.sort((left, right) => left.start - right.start)
}
