# Agent Note: PTO evidence-gated comparison UI

Status: implemented

English | [中文](2026-08-27-pto-evidence-gated-comparison-ui.zh.md)

## Problem

The generic Tool row and details panel can preserve `pto_experiment_compare` JSON, but they cannot make its evidence boundary legible. A business package taking `conversation.details.tool` directly would become responsible for every Tool because that slot has one whole-panel occupant. A global overlay would also need durable cross-call state that a single Tool result does not provide.

Presentation must not turn a lower single observation into a successful experiment. It must also reject malformed or internally inconsistent output even when the Tool call itself settled successfully.

## Decision

`ui-tool` remains the sole occupant of `conversation.details.tool` and adds a keyed, session-scoped child slot named `tool.result.detailview`. `ToolDetails` dispatches the selected frozen call block by wire Tool name and supplies the existing structured/raw renderer as the fallback. Business packages can therefore own one Tool's details without importing the conversation panel or handling unrelated Tools.

`@deepseek-ai/dsh-client-ui-pto-experiments` registers both `pto_experiment_compare` seats: a compact transcript row and a full details body. It reads only the durable Tool result. It does not call the Host, inspect artifacts, or keep another registry projection.

The client parser accepts a closed comparison shape. An `inconclusive` result must contain two collected `pypto-chip-swimlane-makespan-v1` observations, seven matched identity dimensions, a registered baseline experiment, and absolute/relative/direction values consistent with the two metrics. An `incomparable` result must contain no delta. Any failed, running, malformed, or inconsistent result fails closed and exposes no numeric delta.

The UI keeps `inconclusive` and `needs-user-confirmation` visible. Direction may be shown as lower, higher, or unchanged, but is never relabeled supported, successful, or accepted. A global overlay is deferred until a real cross-experiment list, refresh, or active dashboard requirement justifies a registry projection and controller.

## Testing

Model tests cover an admitted -20% comparison, a tampered percentage that becomes evidence-unavailable, an incomparable result with no delta, and Tool error isolation. The client aggregate typecheck covers the new keyed owner type and both components. Package, slot, bundle-purity, generated-catalog, translation-pairing, and composed Web gates cover assembly.

## Alternatives considered

**Let the PTO package occupy `conversation.details.tool`.** Rejected because the single occupant must render every Tool and would duplicate the generic fallback contract.

**Render only a specialized transcript row.** Rejected because seven identity dimensions and side-by-side evidence need the selected-call reading surface.

**Open a shell overlay from the row.** Deferred because one logged Tool result is not a durable dashboard state source; cross-experiment aggregation needs an explicit projection.

**Trust any successful JSON result.** Rejected because a transport-successful but malformed or inconsistent payload must not display a business delta.

## Consequences

PTO comparison now has a replay-stable row-to-details path without a new Host seam or global UI state. Other business Tools can reuse the keyed details contract, and unknown Tools keep the generic renderer. The current surface remains call-scoped and intentionally cannot list or monitor experiments across calls.
