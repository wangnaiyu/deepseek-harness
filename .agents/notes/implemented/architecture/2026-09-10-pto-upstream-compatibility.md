# Agent Note: PTO compatibility with versioned Sessions and resource sidebars

Status: implemented

English | [中文](2026-09-10-pto-upstream-compatibility.zh.md)

## Problem

PTO browser drafts defer Session creation, while generic file uploads require a real Session. Project directory aliases must also preserve released Session generations. The resource sidebar does not provide the Tool details slots assumed by the [comparison presentation decision](2026-08-27-pto-evidence-gated-comparison-ui.md).

## Decision

The PTO fork on upstream 0.1.6 writes V4 because analysis-source additions change persisted user-message, inbox, and title-request unions. The V3-to-V4 edge preserves event bodies, sequence references, compact runs, and inherited cuts; it reuses the frozen V3 codec and validates the V4 header. Writes publish only the final successor and retain historical bytes. This fork allocation is not an upstream release: a future upstream V4 requires an explicit format-identity review before integration.

A draft owns browser attachments until materialization. First submit binds pending generic files to the new Session and waits for upload settlement before sending the prompt. Formal capability admission retains its existing rejection behavior. Removing an attachment releases its browser resource only when the input shell accepts removal.

Project aliases select the directory for new Sessions. Discovered conventional or aliased directories retain their identity; writes target the current generation inside that directory. Adjacent migration retains committed predecessors and uses the upstream file lease.

The keyed PTO comparison transcript row owns a native disclosure containing the complete frozen evidence body. This replaces only the details-slot mechanism in the earlier decision. Evidence validation, the seven identity dimensions, inconclusive labels, and the prohibition on inferring business success remain unchanged. Resource sidebar slots remain owned by upstream packages.

The 0.1.6 adaptation keeps the upstream main-panel shell, permission selector, draft editor runtime and recency/manual-order engine. PTO draft state feeds their current contracts. Hidden blank Sessions retain their manual-order identity until the first prompt. SSH directory reservation forwards the per-call policy and preserves existing-target rejection. The pre-existing PTO receipt history read remains a deferred projection migration under the upstream deprecation policy.

## Testing

Session persistence tests cover conventional and aliased routing plus immutable generation migration. Composer tests cover accepted attachment removal and rejected removal. Comparison presentation tests require the disclosure to contain all seven identity rows and significance evidence. Built workbench verification covers the composed package and resource closure.

## Alternatives considered

Restoring the removed Tool details panel would reintroduce an obsolete global owner and conflict with resource sidebars. Dropping the evidence body would lose the rationale needed to interpret a comparison. Creating a Session for every draft attachment would violate deferred draft materialization. Writing into a predecessor generation would violate released Session preservation.

## Consequences

PTO retains its original evidence and draft capabilities through upstream APIs. This adaptation does not redesign Viewer launch identity, admission receipts, new-launch/retry policy, or the experiment dashboard width. Their observed behavior requires separate repair triage.
