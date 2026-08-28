---
description: "Browser dashboard and evidence-gated comparison presentation for durable PTO experiments; for users and maintainers inspecting, executing, or cancelling experiment records."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-pto-experiments

English | [中文](README.zh.md)

## Summary

This browser-only package presents durable PTO experiments. It registers a session-scoped **Experiments** conversation view backed by the `ptoExperimentDashboard` Remote, plus a keyed transcript row and details body for `pto_experiment_compare`. The details body is delegated by `ui-tool`; unknown tools keep the generic renderer.

The dashboard reads the authoritative Workspace-confined registry through an existing Session id; the browser cannot supply a path. A planned row can start the trusted long execution Remote with its visible optimistic revision. While approval or execution is active, the row exposes an explicit cancel action only to the initiating Session. Unmount never sends cancellation; remount reloads Host activity. Execute and cancel settlement trigger an authoritative refresh, while loading, empty, action-error, and Remote-error states remain contained inside the view.

The UI is evidence-gated. It parses a closed comparison schema, verifies that an inconclusive delta is consistent with two collected app-owned metrics and seven matched identity dimensions, and never calculates or upgrades a business conclusion. Failed, running, or malformed outputs render as error/pending/evidence-unavailable states with no delta.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="model-experience"></a>

## Model Experience

### Comparison result presentation

#### What the model sees

Nothing new. The package adds no prompt text or Tool definition. Comparison presentation renders a frozen result already present in the session log; dashboard reads are browser-to-Host UI queries and do not enter model context.

#### Token effect

None. The package neither changes the assembled model request nor adds a Tool result beyond the result produced by `pto_experiment_compare` itself.

#### KV Cache effect

None. Presentation is browser-local and does not alter the reusable prompt prefix or any per-Turn model context.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- It supports the current single-L2-run chip-swimlane makespan schema only.
- Automatic polling/push invalidation, a global overlay, L3 evidence, multi-sample statistics, and user-owned thresholds remain deferred.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
