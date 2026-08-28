/** `ptoBrand` namespace dictionaries for the workbench wordmark. */
export const NS = 'ptoBrand'

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  wordmark: 'PTO Agent 工作台',
  badge: 'DSH',
} satisfies Record<string, string>

/** Closed locale key vocabulary for PTO brand presentation. */
export type PtoBrandKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  wordmark: 'PTO Agent Workbench',
  badge: 'DSH',
} satisfies Record<PtoBrandKey, string>
