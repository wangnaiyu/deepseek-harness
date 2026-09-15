---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-15-pto-analysis-source-v4

English | [中文](2026-09-15-pto-analysis-source-v4.zh.md)

## Summary

Allocate fork Session V4 for PTO analysis-source metadata in persisted message, inbox, and title-request unions.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-09-15-pto-analysis-source-v4
baseline: false
changes:
  - root: "SessionHeader"
    previous: "2026-09-11-initial"
    after: "1a3440e3577382704d42a6263aa463504eb74c566734a55e9503a63efcd02445"
    decision: version-bump
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-14-image-offload"
    after: "7cbf1468009ee27bbcabb00b5bbd6d6a0d6d01343a62756ef650191b64177c32"
    decision: version-bump
  - root: "event:session/title-llm-request"
    previous: "2026-09-14-image-offload"
    after: "ff5c3f75d54e811f9e1a2709ceeffa3fa12da3ee045356a86ebde5c955c930b8"
    decision: version-bump
  - root: "event:user/message"
    previous: "2026-09-14-image-offload"
    after: "b6bfe55eae935358c9d39358c4ea24b99c4bad2f8a1921f4f967fe56f2cc2811"
    decision: version-bump
```

<a id="compatibility"></a>
## Compatibility

The PTO fork on upstream 0.1.6 writes V4 because analysis-source additions change persisted user-message, inbox, and title-request unions. The V3-to-V4 edge preserves event bodies, sequence references, compact runs, and inherited cuts; it reuses the frozen V3 codec and validates the V4 header. Writes publish only the final successor and retain historical bytes. This fork allocation is not an upstream release: a future upstream V4 requires an explicit format-identity review before integration.

<a id="verification"></a>
## Verification

Full build, 503 migration/catalog/JSONL regression tests, the built publication Worker smoke, and the keyless SDK text-turn successor refresh passed. Tests cover strict admission, immutable predecessors, source drift, target conflicts, independent seeded cuts, and deterministic repeated restoration.

<a id="dev-note"></a>
## Dev Note

None.
