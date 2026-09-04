---
description: "Durable, Workspace-confined PTO experiment planning, trusted execution, metric collection, and comparison; for users and maintainers operating evidence-gated optimization runs."
kind: "package-reference"
---

# @deepseek-ai/dsh-pto-experiments

English | [中文](README.zh.md)

## Summary

Durable, Workspace-confined PTO experiment planning, query, trusted Host execution, metric-collection, and comparison service. It owns `ctx.ptoExperiments`, the `pto_experiments` storage domain, four model tools, and one non-tool `execute()` admission API.

No runtime invariant companion is published because the private service owns every write, storage-domain serializes durability, and the schema validates the complete ledger when reopened.

## Table of Contents

- [Service contract](#service-contract)
- [Failures and limits](#failures-and-limits)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="service-contract"></a>
## Service contract

`plan(scope, input)` resolves the Session Workspace, source, baseline, and candidate through `ctx.fs`. Source and baseline must be existing directories inside the Workspace; the candidate must be absent, inside source, disjoint from the baseline, and not already owned by another experiment in that Workspace. Baseline admission uses `recognizePtoRun()` from `@deepseek-ai/dsh-tool-pto-run`.

The service serializes candidate ownership checks with each durable put. A planned record has a Host-generated id, whole-record revision `0`, an append-only `planned` event, unverified source/environment identities, `authorization: null`, `candidateOutput.precondition: absent-observed`, and the exact future command plus timeout. Planning does not create the candidate path, modify source, request approval, or execute work.

`get(scope, id)` and `list(scope, limit?)` compare the current resolved Workspace target identity with the durable owner. Another Workspace receives no record. List order is newest first; the default limit is 20 and the maximum is 100, with `total` and `truncated` reporting omitted rows. Returned views are detached copies and omit the storage-only Workspace and filesystem target keys.

`execute(scope, { experimentId, expectedRevision })` is a trusted Host API and is intentionally not registered as a model tool. It accepts only `planned` at the expected revision and performs the complete admission loop: confirm the approving Agent Session owns the same Workspace; re-resolve containment, disjointness, baseline recognition, and candidate absence; bind a clean Git `HEAD` identity and a fixed Python/PyPTO environment probe; ask the user about that exact revision, identity pair, output path, command, timeout, declared change, stop conditions, and rollback plan; then repeat identity and path checks before atomically reserving the candidate directory.

Only an `allowed-once` decision proceeds. One durable put binds the service-issued approval id, records both trusted identities and the reservation version, and appends `identities-bound`, `authorized`, and `execution-started` before the workload begins. The stored command runs from source under `danger-full-access` with `DSH_PTO_EXPERIMENT_ID` and `DSH_PTO_EXPERIMENT_OUTPUT_DIR`; the workload must write the exact recognized run directly into that managed output directory. Exit zero completes only after `recognizePtoRun()` recognizes that directory. Other exits, signals, timeouts, sandbox failures, infrastructure failures, cancellation, or a missing PTO marker settle a terminal `failed`/`cancelled` event. Once `running` is durable, terminal settlement deliberately drops the workload cancellation signal so aborting the command cannot also abort its audit write. Stdout/stderr content is not persisted.

The zod durable schema validates `planned → authorized → running → completed|failed|cancelled` and a contiguous event ledger whose final revision/state matches the materialized record. On service initialization, a durable `running` record is recovered as `failed` because its foreground process cannot survive Host restart. No granular authorize/begin/complete methods or model tools exist.

After a recognized L2 run completes, the app-owned `pypto-chip-swimlane-makespan-v1` adapter reads bounded current `dfx_outputs/chip_swimlane_records.json` and `compiled_meta.json` artifacts from that exact run. Its fixed Python probe calls PyPTO's official `read_perf_data()` conversion and records a single `device-dispatch-makespan` observation plus metric, task, hardware, source, environment, command, and artifact identities. Missing, malformed, legacy, unsupported, or L3 evidence records `not-observed`/`invalid` without failing the completed run.

`compare(scope, { experimentId, expectedRevision })` is also available as `pto_experiment_compare`. It accepts only a completed record at the expected revision and only compares against a baseline that is itself an app-owned completed experiment output in the same Workspace. Metric, task, hardware, environment, command, source-root, and exact committed Git-diff identities must all match before a delta is calculated. Admitted single-observation deltas remain `inconclusive` until a user-owned threshold and repetition/significance rule exists; all missing or mismatched evidence returns `incomparable` without a delta.

<a id="failures-and-limits"></a>
## Failures and limits

Required text fields accept at most 4,096 characters. A proposal accepts at most 64 evidence references of at most 1,024 characters each. Execution timeouts default to one hour and cannot exceed deployment `maxExecutionTimeoutMs` (24 hours by default). Chip-swimlane input defaults to a 64 MiB `maxMetricArtifactBytes` bound; `compiled_meta.json` is fixed at 1 MiB. Invalid paths, unsupported baseline markers, containment or disjointness violations, existing candidate paths, duplicate candidate ownership, invalid limits/revisions, missing records, cross-Workspace access, dirty or non-Git source, and unavailable PyPTO reject closed.

The source must be a clean committed Git worktree, including no untracked files. The candidate's parent directory must already exist because reservation is deliberately non-recursive. If reservation succeeds but the following durable put fails, an empty orphan candidate directory can remain; no workload starts, and the non-reusable path makes the failure visible and fail-closed.

<a id="model-experience"></a>
## Model Experience

### Tool schemas

#### What the model sees

The model sees the generated [`pto_experiment_plan`, `pto_experiment_get`, `pto_experiment_list`, and `pto_experiment_compare` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-pto-experiments) when the PTO profile enables this package. The prompt states that planning records absence but does not authorize work, reserve output, modify source, or execute a workload, and that comparison requires app-owned collection on both sides.

#### Token effect

Four schemas and one short prompt section add a fixed request prefix. Plan/get return one complete record; list returns at most the requested bounded count; compare returns two metric observations, seven identity dimensions, and at most one delta.

#### KV Cache effect

The definition prefix is stable while plugin scope is unchanged. Tool arguments and results append after the reusable prefix.

### Tool-call history and result

#### What the model sees

Results are structured JSON. A planned record preserves baseline/source/environment/change/control/execution facts and explicitly exposes unverified identities, absent-only output observation, and missing authorization. Host execution is not model-callable; later get/list results can expose the durable trusted identities, approval receipt, lifecycle ledger, actual-run recognition, metric observation, or bounded failure reason. Compare returns `incomparable` without a delta when evidence is missing or mismatched, otherwise an `inconclusive` directional delta. List results carry `experiments`, `total`, and `truncated`.

#### Token effect

One record scales with declared controls and evidence references. List output scales with the bounded record count and can be reduced with `limit`.

#### KV Cache effect

Durable tool results remain ordinary append-only history and do not invalidate the earlier definition prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The domain has no deletion, archival, or retry operation. List is bounded, but storage grows with experiments; a terminal record cannot be returned to `planned`.
- Crash recovery records an interrupted foreground run as failed; it cannot reattach to or kill a process from the previous Host lifetime.
- The environment adapter identifies the configured Python and importable PyPTO package, but does not yet bind drivers, devices, compiler binaries, or workload-specific dependencies.
- Metric collection supports only the current L2 `chip_swimlane_records.json` plus `compiled_meta.json` shape. Legacy `l2_swimlane_records.json`, L3 dispatch trees, automatic reruns, multiple observations, thresholds/significance policy, and experiment UI remain deferred.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
