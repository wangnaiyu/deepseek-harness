---
description: "PTO V5 codecs and explicit compatibility for the two historical V4 lineages."
kind: "package-library"
---

# @deepseek-ai/dsh-session-format-v4-to-v5

English | [中文](README.zh.md)

## Summary

This pure library separates the PTO writer from the incompatible historical PTO and upstream V4 formats. Official V4 advances to V5 with unchanged event coordinates. Legacy PTO V4 contains V3 bodies and requires an explicit catalog selection before conversion through upstream's V3 transformations. [JSONL persistence](../session-persistence-jsonl/README.md) owns immutable originals and verified successor publication.

## Table of Contents

- [Lineage selection](#lineage-selection)
- [Validation](#validation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="lineage-selection"></a>
## Lineage selection

The default catalog reads upstream V4. A PTO deployment sets `legacyPtoV4: true` on JSONL persistence for a root containing pre-upgrade PTO V4. That root must not contain upstream V4. Version numbers and payload inspection cannot establish the producer; the deployment supplies that fact. V5 is identical under either configuration.

The legacy reader preserves the frozen PTO V4 framing. Its V4-to-V5 edge reuses the upstream V3-to-V4 converter for tool results, producer sources, references, inherited cuts, interrupted turns and child catalogs. Legacy V4 delivery markers become historical V3 markers before conversion; current V5 delivery markers validate their own ownership. Unknown required events, invalid child facts and inconsistent parent/child identities refuse conversion. Standalone transcript replay may bind an explicitly empty child set; persistence collects the full available direct-child set.

PTO analysis metadata survives conversion unchanged. Skill invocation producers record the exact provider; older upstream records may omit that field. Neither path runs tools, sends model requests, mutates an original generation, nor provides downgrade support.

<a id="validation"></a>
## Validation

The codec retains upstream V4 physical framing and message admission under a V5 header. Current and transformed restoration validate relationships, including inherited upstream V4 and current V5 delivery coordinates. No runtime invariant companion is published because this library owns no mutable runtime state, and each restore validates its artifact before publication.

<a id="dev-note"></a>
## Dev Note

The archived [legacy acknowledgement](../../../docs/persistence-changes/legacy-pto-v4/2026-09-15-pto-analysis-source-v4.md) records the old fork allocation. The current [format authority](../../../docs/session-format-status.md) owns writer and release status.

<a id="model-experience"></a>
## Model Experience

### Historical restoration

#### What the model sees

No new prompt or tool output. Historical conversion preserves admitted `user/message` and tool content while translating its stored representation.

#### Token effect

Restores admitted historical messages; adds no prompt content.

#### KV Cache effect

None for current Sessions; replay rebuilds the converted historical message sequence without issuing requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Mixed upstream/PTO V4 roots require explicit separation before opening them; automatic lineage detection is unsupported.
- Inconsistent historical child metadata requires independent investigation. The converter refuses to invent discovery facts or alter the original log.
