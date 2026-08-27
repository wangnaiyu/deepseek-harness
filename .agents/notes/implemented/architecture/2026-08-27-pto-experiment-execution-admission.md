# Agent Note: Trusted PTO experiment execution admission

Status: implemented

English | [中文](2026-08-27-pto-experiment-execution-admission.zh.md)

## Problem

A durable PTO proposal is not authorization to run an arbitrary command. Before workload execution, the Host must prove which immutable source revision and PyPTO environment the user saw, bind the one-shot decision to the exact experiment revision, exclusively own the new output directory, and make `running` durable. Independent model tools or an observed-absent path would permit reordered, stale, or fabricated transitions.

PyPTO 3.0 does not supply the reservation primitive: its compile path accepts an explicit output directory with `exist_ok=True`, while its build-dir environment variable is only a base for a generated child. The application therefore needs an exact candidate-path contract outside PyPTO.

## Decision

`ApprovalService.requestDecision()` returns the service-issued audit id with the closed outcome only after both approval events commit. `FileSystem.reserveDirectory()` atomically creates one empty final directory, requires an existing parent, rejects every existing final entry with `FS_ALREADY_EXISTS`, and never turns committed creation into an ambiguous abort. Local, sandboxed-local, and E2B providers implement the same contract.

`PtoExperimentStore.execute()` is the only execution transition API and is not a model tool. It accepts an Agent Session, Workspace, experiment id, and expected planned revision. It verifies Workspace ownership; re-resolves recorded target identities, containment, baseline disjointness/recognition, and candidate absence; then uses fixed subprocess argv to bind a clean Git `HEAD` and the configured Python/PyPTO environment. The user sees that exact revision, both identity hashes, candidate, stored command and timeout, declared change, stop conditions, rollback, and `danger-full-access` mode.

Only `allowed-once` proceeds. The executor repeats identities and mutable target checks after approval, reserves the candidate, and performs one whole-record put that appends `identities-bound`, `authorized`, and `execution-started` and makes `running` durable before work starts. It runs the stored command from source with Host-owned `DSH_PTO_EXPERIMENT_ID` and exact `DSH_PTO_EXPERIMENT_OUTPUT_DIR`. It does not persist stdout/stderr content. Exit zero completes only when the exact directory is recognized through the shared PTO run recognizer; every other outcome is terminal failed/cancelled. Initialization recovers leftover foreground `running` records as failed.

Dashboard execution reaches that same API through a private plugin follow-up on the initiating live Agent. The dashboard gateway consumes the message at `agent/pre-step`, owns the blocked turn, and returns `reject`, so approval events retain their required open-turn audit boundary without a model-facing `user/message`, model step, or LLM request. A Host-owned controller cancels the workload, while terminal registry settlement deliberately drops the aborted workload signal so durable `cancelled` cannot be suppressed. If cancellation removes a still-queued follow-up, the gateway settles the long execution call from the current durable record; lookup failure rejects both calls instead of orphaning one.

## Testing

Tests cover approval audit-id binding, local exclusive directory creation and concurrent one-winner behavior, sandbox containment, the complete allowed route, rejection without reservation, dirty-source failure before approval, zero-exit output without a PTO marker, cancellation after durable `running`, and cancellation before pre-step. Real PTO-profile browser QA covers approval-to-completion plus running/unmount/remount/cancel-to-durable-cancelled. Package type checks and the full Host build verify that planning-only compositions remain loadable while execution dependencies are required dynamically by the Host route.

## Alternatives considered

**Expose bind/authorize/begin/complete tools.** Rejected because model calls cannot prove a user decision, filesystem reservation, process result, or ordering across those facts.

**Let the workload create the candidate.** Rejected because PyPTO's `exist_ok=True` behavior cannot distinguish exclusive ownership from reuse or a check-create race.

**Reserve during planning.** Rejected because a proposal is not authorized execution and abandoned proposals would consume paths.

**Use caller-supplied identity strings or probe commands.** Rejected because the caller could fabricate trust facts. The Host owns fixed Git and Python/PyPTO probes; the approved workload command remains a separate declared execution input.

**Persist command output for diagnostics.** Rejected for this slice because output may contain L2/L3 data. Terminal records retain process and recognition facts, not captured content.

## Consequences

No workload starts before a revision-bound user receipt, repeated trusted identity verification, exclusive output ownership, and durable `running` state. Models retain proposal/query capabilities without gaining a state-mutation escape hatch. Clean committed Git is a deliberate recoverability requirement; untracked source changes fail admission.

If directory reservation commits and the following durable put fails, an empty orphan directory may remain. This is fail-closed: the workload never starts and the path cannot be silently reused. Host restart cannot reattach to a foreground child, so recovery records failure rather than claiming completion. App-owned metric collection/comparison and the Session-scoped experiment UI are now downstream consumers of the same registry; driver/device/compiler identity and retry/archive policy remain later work.
