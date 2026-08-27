# Agent Note: Durable PTO experiment planning records

Status: implemented

English | [中文](2026-08-27-pto-experiment-planning-registry.zh.md)

## Problem

PTO analysis, debugging, optimization, comparison, and review can describe a candidate experiment, but an ordinary model answer, Skill document, shell transcript, or output directory name cannot establish application-owned experiment identity. A real execution needs one durable record that binds an immutable baseline, recoverable source Workspace, environment, declared change, candidate output, stop and rollback controls, authorization, and the actual run. Creating execution transitions before the application can prove user authorization or exclusively reserve the candidate directory would turn an observed path and a generic approval outcome into guarantees they do not provide.

## Decision

`@deepseek-ai/dsh-pto-experiments` owns `ctx.ptoExperiments` and the versioned `pto_experiments` storage domain. It exposes `pto_experiment_plan`, `pto_experiment_get`, and `pto_experiment_list` to the model. Planning resolves every path through `ctx.fs`, confines it to the calling Session Workspace, admits the baseline through [`recognizePtoRun()`](../../../../packages/pto/tool-pto-run/README.md#host-api), requires the candidate to be absent inside source and disjoint from baseline, and serializes duplicate candidate ownership checks with the durable write.

One proposal receives a Host-generated id, revision `0`, and a contiguous append-only event ledger beginning with `planned`. At planning time, source and environment identities remain `unverified`, authorization and actual run remain `null`, and the candidate precondition is `absent-observed`. Model tools still write only `planned@revision=0`; the later trusted Host API described in the [execution-admission Agent Note](../architecture/2026-08-27-pto-experiment-execution-admission.md) owns the remaining lifecycle transitions.

Workspace ownership uses the filesystem provider's opaque target identity rather than a caller-supplied path string. Reads and bounded newest-first lists return detached public views only for the current Workspace; storage-only Workspace and filesystem target keys never enter the model result. JSON domain storage restores the same records after Host restart.

### Authorization and reservation boundary

At this planning slice, the generic approval service returned `allowed-once` without its service-issued audit request id. The execution slice subsequently added `requestDecision()` so one trusted path can bind experiment id, expected revision, actor, Session id, and approval audit id.

At this planning slice, the filesystem service could observe a missing directory but had no generic exclusive directory-create operation. Planning still must not create an abandoned candidate directory merely to hold a proposal. The execution slice added atomic `reserveDirectory()`; the executor commits `running` only after reservation succeeds. PyPTO's permissive `exist_ok=True` output creation remains unsuitable as a reservation mechanism.

## Testing

Unit and real Loader/YAML composition tests cover L2/L3 marker reuse, durable JSON restart, cross-Workspace denial, concurrent duplicate candidate proposals, baseline/candidate disjointness, candidate non-creation, model-visible tool registration, and the prompt's non-authorization statement. The package zod schema validates the persisted record and ledger on reopen.

## Alternatives considered

**Persist the Skill or shell transcript.** Rejected because presentation history does not provide atomic record revision, Workspace ownership, candidate uniqueness, or executor-only transitions.

**Expose authorization and lifecycle tools to the model.** Rejected because a model call cannot prove a user decision or executor outcome. Proposal and query are model-facing; authoritative transitions belong to trusted Host consumers.

**Treat planning-time absence as output reservation.** Rejected because another process can create the path after observation and PyPTO accepts an existing explicit output directory.

**Create the candidate directory during planning.** Rejected because a proposal is not authorized execution, abandoned plans would leave ambiguous directories, and the current filesystem abstraction does not own an exclusive directory-create operation.

**Copy the PyPTO run marker logic.** Rejected because two recognizers would drift. `tool-pto-run` exports the one marker-backed Host API used by discovery and experiment planning.

## Consequences

PTO Skills and later UI can refer to one durable, Workspace-owned proposal without implying that it ran. Host restart preserves proposals, concurrent plans cannot claim the same candidate within one service instance, and model-facing text truthfully distinguishes observed absence from authorization and reservation.

The planning boundary remains unchanged even though a separate trusted Host API now closes the operational loop: model calls cannot authorize or settle experiments, and `absent-observed` is still not a lock. Planned and terminal records accumulate until an archival policy and consumer justify a deletion operation.
