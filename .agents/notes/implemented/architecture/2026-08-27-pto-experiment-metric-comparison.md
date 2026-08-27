# Agent Note: App-owned PTO metric comparison

Status: implemented

English | [中文](2026-08-27-pto-experiment-metric-comparison.zh.md)

## Problem

A PTO candidate and baseline can both contain performance-looking files without being comparable. A path supplied by the model does not prove who produced the run, which metric definition was used, whether task and hardware identities agree, or which committed source change separates the observations. Directly subtracting two numbers would turn incomplete evidence into a product conclusion. Conversely, making metric absence fail a recognized workload would conflate experiment execution with optional DFX availability.

PyPTO owns the conversion from device cycles and task records into dispatch/finish timing. The workbench must consume that authority without copying its formulas into an independently drifting parser, while keeping artifact reads bounded and L2/L3 data inside the existing execution trust boundary.

## Decision

`PtoExperimentStore` owns a fixed `pypto-chip-swimlane-makespan-v1` adapter. After a recognized L2 candidate completes, it reads only `dfx_outputs/chip_swimlane_records.json` and `compiled_meta.json` from the exact reserved run. Paths must remain contained and sizes are bounded. A fixed Python probe imports `simpler_setup.tools.swimlane_converter.read_perf_data()` from the already bound PyPTO environment, requires chip-swimlane level 2 or greater, and derives one `device-dispatch-makespan` value as latest finish minus earliest dispatch.

The durable observation includes an app-owned metric-definition identity, task identity from the compiled contract plus joined task topology, hardware identity from compiled platform/backend plus swimlane clock/core facts, artifact digests, and source/environment/command lineage. Collection is fail-soft after run recognition: missing current artifacts are `not-observed`; malformed, escaped, oversized, or unsupported evidence is `invalid`; either state preserves the completed experiment. L3 dispatch trees and legacy `l2_swimlane_records.json` are intentionally not guessed by this adapter.

`compare()` and the model-facing `pto_experiment_compare` tool accept a completed record at its expected revision. The baseline must be the registered actual output of another completed experiment in the same Workspace. Metric, task, hardware, environment, execution-command, source-root, and exact committed Git-diff identities must all be available and matched before the service emits a combined delta. Any missing or unequal dimension returns `incomparable` and `delta: null`.

An admitted delta reports absolute and relative change and whether lower makespan improved, regressed, or stayed unchanged. Its result is always `inconclusive` and significance is `needs-user-confirmation`, because the registry does not yet own a user-approved threshold, repetition count, variance model, or significance rule. Comparison is derived on demand from durable observations; it is not another mutable lifecycle transition.

## Testing

Tests cover collected metric persistence, public removal of filesystem target keys, completed runs with `not-observed` metrics, rejection of an unowned baseline, an admitted lower-makespan delta across a non-empty committed Git change, and incomparability when task identity changes. Package type checks, contract lint, generated catalogs, bilingual pairing, and the Host build cover the public and composed surfaces.

## Alternatives considered

**Compare arbitrary run directories.** Rejected because path recognition proves artifact shape, not app ownership, lineage, metric definition, or baseline immutability.

**Reimplement PyPTO cycle conversion in TypeScript.** Rejected because PyPTO's converter is the authoritative join and timing implementation. A second parser would drift from upstream semantics.

**Fail a completed experiment when DFX is absent.** Rejected because the approved workload and recognized output can be valid while optional metric evidence is unavailable. The unavailable metric must block comparison, not rewrite execution outcome.

**Declare improvement from one lower value.** Rejected because direction is arithmetic, while support for a hypothesis requires user-owned thresholds and repetition/significance policy that this slice does not have.

**Persist comparison records.** Rejected for now because the result is a pure derivation from immutable observations and a fixed Git diff. Persisting it would add revision and invalidation semantics without adding evidence.

## Consequences

The workbench can now show a bounded, explainable comparison only for runs it produced and identified. Missing or mismatched evidence fails closed at the comparison boundary, while successful workload records remain truthful. The service does not silently accept legacy or L3 layouts and cannot yet make statistical or business acceptance decisions. Adding those capabilities requires a new versioned adapter or policy layer rather than widening this adapter by guesswork.
