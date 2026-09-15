---
description: "Preserve V3 Session events while advancing PTO analysis source metadata to V4."
kind: "package-library"
---

# @deepseek-ai/dsh-session-format-v3-to-v4

English | [中文](README.zh.md)

## Summary

This library restores V3 Sessions into V4 without changing their event bodies, identities or positions. The build-static Session format catalog selects the edge. V4 gives the PTO analysis source variants a distinct writer version while retaining V3 physical framing and validation.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The [format catalog](../session-format-catalog/README.md) imports this library directly. It is not a profile plugin. Header migration changes only the version; body migration preserves existing data. Malformed headers and unknown required events remain errors.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The edge delegates physical framing and relationship validation to the frozen V3 implementation through private header copies. It returns the original V4 artifact. Each stage owns its inherited-cut state; compact Assistant runs pass through unchanged. Earlier cardinality-changing edges can supply an inherited cut through the delivered end-seed marker. The persistence provider owns successor publication and preserves predecessor files.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Session format library](../session-format/README.md) — migration stage contracts.
- [PTO compatibility decision](../../../.agents/notes/implemented/architecture/2026-09-10-pto-upstream-compatibility.md) — fork integration scope.

-----

<a id="model-experience"></a>

No runtime invariant companion is published because this library owns no Cordis lifecycle or mutable runtime state.

## Model Experience

None, as this library preserves stored events and registers no model-facing capability.

#### KV Cache effect

The identity edge does not add prompt text or alter retained message bodies.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- V4 is a PTO fork format. This edge does not provide downgrade or compatibility with a future upstream format using the same integer.
- The edge preserves V3 validation limits; it does not reconstruct missing receipt metadata.

<a id="dev-note"></a>
### Dev Note

None.
