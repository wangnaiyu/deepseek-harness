---
description: "Read-only PyPTO run discovery, marker recognition, and bounded artifact capability inspection; for users and maintainers locating evidence without reading artifact contents."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-pto-run

English | [中文](README.zh.md)

## Summary

Read-only PTO run discovery and artifact capability inspection for the current Session workspace.

## Table of Contents

- [Tools](#tools)
- [Host API](#host-api)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="tools"></a>
## Tools

- `pto_run_discover` performs a bounded, on-demand scan. It recognizes PyPTO 3.0 L2 runs by top-level `kernel_config.py` and L3 runs by `orchestration/host_orch.py`; names and timestamps are never recognition evidence.
- `pto_run_inspect` accepts a workspace-contained run path and reports normalized evidence, compile-side health, exact optional-DFX collection literals, diagnostic artifact paths, and rerun capabilities without reading artifact contents or inferring a diagnosis.

Discovery prunes `.git`, `node_modules`, `__pycache__`, and `3rdparty`, stops descending after it recognizes a run, and does not expose `next_levels` child builds as independent runs. Inspection reports those children under their L3 parent.

<a id="host-api"></a>
## Host API

`recognizePtoRun(fs, target, signal?)` exposes the same marker test used by discovery without inventorying artifacts. Host-side PTO consumers use it to admit a known directory without maintaining a second recognizer. It returns `undefined` for a directory without a supported marker and propagates filesystem or cancellation failures.

<a id="model-experience"></a>
## Model Experience

### Tool schemas

#### What the model sees

The model sees the generated [`pto_run_discover` and `pto_run_inspect` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-pto-run) whenever this plugin is visible. Discovery takes no arguments; inspection takes one `run_path` returned by discovery or another path inside the Session workspace.

#### Token effect

The two schemas and one short prompt section add a fixed request prefix. Results scale with the number of recognized runs, artifacts, and L3 child builds, subject to deployment bounds.

#### KV Cache effect

The definition prefix is stable while plugin configuration and scope visibility are unchanged. Each result is appended after the reusable prefix.

### Tool-call history and result

#### What the model sees

Results are structured JSON. Capability status is `available`, `not-observed`, or `unknown`; `not-observed` only means the bounded artifact inventory did not find supporting evidence. Optional DFX capabilities carry exact `RunConfig` and pytest collection literals. `runHealth.compileStatus=incomplete-or-failed` is reserved for a complete L2 inventory that observed no files under `passes_dump/`, `ptoas/`, or `kernels/`; truncated inventories and L3 parents remain `unknown`. Run identity remains `unverified` because a directory name does not establish source or build identity.

#### Token effect

Discovery is compact. Inspection returns a fixed capability list plus observed relative paths and can be larger for distributed runs.

#### KV Cache effect

Tool arguments and results are append-only and do not invalidate the earlier definition prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The recognizer and normalized capability names target the PyPTO 3.0 artifact contract; they do not classify PyPTO 2.x or Pro runs.
- The scan is finite and reports `truncated=true` when its configured directory, depth, or result bounds prevent a complete answer.
- Artifact presence proves only that evidence was observed. It does not prove freshness, completeness, source identity, a causal diagnosis, or that raw data is safe to share.
- Optional DFX absence is reported separately from compile-side incompleteness. A missing DFX artifact may still result from interrupted execution, so the collection literal is a recovery aid rather than proof of cause.
- L3 parent compile health remains `unknown`; inspect the relevant `next_levels` child before making a compile-side health claim.
- `fullRecompile` stays `unknown` because it depends on a compatible source workspace, dependencies, and toolchain rather than the run directory alone.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
