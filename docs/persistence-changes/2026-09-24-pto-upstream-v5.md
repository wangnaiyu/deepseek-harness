---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-24-pto-upstream-v5

English | [中文](2026-09-24-pto-upstream-v5.zh.md)

## Summary

Allocates PTO writer V5 to separate the incompatible legacy PTO and upstream V4 lineages, retaining PTO analysis attribution and optional exact Skill provider metadata.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-09-24-pto-upstream-v5
baseline: false
changes:
  - root: "SessionHeader"
    previous: "2026-09-16-session-format-v4"
    after: "22c6899a78214dd841c266348ae997027ef391174ddb21127f1b71dc1b362824"
    decision: version-bump
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-16-session-format-v4"
    after: "29475abc4bce8ae12d933fd40f7779b22af8858eb56b3946e38e65f99b5ca32f"
    decision: version-bump
  - root: "event:developer/message"
    previous: "2026-09-16-session-format-v4"
    after: "dd7545cc51730a0c9385a97a2856a59a608dfe17053844b13387df372ac7f885"
    decision: version-bump
  - root: "event:session/title-llm-request"
    previous: "2026-09-16-session-format-v4"
    after: "1198e7c348d28f03480e50f2ab9b6dbbc254c4a69dec2cc0103416ae640a37e5"
    decision: version-bump
  - root: "event:user/message"
    previous: "2026-09-16-session-format-v4"
    after: "3b3d2a6ec2119fc69908f6a8233201e2f95bc0921484f2931af4335bf4b89b3e"
    decision: version-bump
```

<a id="compatibility"></a>
## Compatibility

Official V4 preserves its event coordinates in V5. Explicit legacyPtoV4 catalog selection decodes the frozen PTO V4 body as V3 and applies the upstream body conversion with complete available child evidence. Original files remain immutable; only verified V5 successors are published. Required unknown events and inconsistent child facts refuse conversion. Historical upstream Skill invocation sources may omit provider. The prior fork acknowledgement is archived unchanged outside the official linear history.

<a id="verification"></a>
## Verification

The 386 format owning tests passed in the compatibility run. Four real JSONL lineage tests cover both physical encodings, read-only preparation, verified write publication, native reopen, unchanged original bytes, and refusal without explicit legacy selection. SDK owner refresh passed 22 keyless scenarios; broader upgrade validation is recorded by the maintenance task.

<a id="dev-note"></a>
## Dev Note

None.
