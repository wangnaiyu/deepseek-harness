---
description: "The PTO package group: durable experiment orchestration and read-only PyPTO run evidence for readers choosing or navigating optimization capabilities."
kind: "package-group"
---

# pto/ — experiment and run evidence capabilities

English | [中文](README.zh.md)

## Summary

The PTO package group lets an Agent discover existing PyPTO runs and manage durable, evidence-gated optimization experiments inside one Workspace. `tool-pto-run` owns read-only run recognition and bounded artifact inspection. `pto-experiments` owns planning, trusted execution, metric collection, and comparison. Both packages keep paths confined to the current Session Workspace.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

These packages separate observation of existing evidence from creation and comparison of managed experiments.

| Package | Role |
|---|---|
| [`pto-experiments`](pto-experiments/README.md) | Plans, executes, records, measures, and compares durable PTO experiments. |
| [`tool-pto-run`](tool-pto-run/README.md) | Discovers supported PyPTO runs and reports bounded artifact capabilities without reading artifact contents. |

<a id="related-documentation"></a>
## Related documentation

- [PTO experiments subsystem](../../docs/subsystems/pto-experiments.md) — types, lifecycle rules, trusted execution, and comparison semantics.
- [Tool catalog](../../docs/tool-catalog.md) — generated schemas for the model-facing PTO tools.

<a id="dev-note"></a>
## Dev Note

None.
