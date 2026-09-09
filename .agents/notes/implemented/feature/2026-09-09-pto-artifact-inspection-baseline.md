# Agent Note: PTO artifact inspection baseline

Status: implemented

English | [中文](2026-09-09-pto-artifact-inspection-baseline.zh.md)

## Problem

PTO users need to inspect existing artifact directories without creating a Session or executing a workload. A filename alone does not establish viewer support or the identity of an official analysis Skill.

## Decision

The [Host inspection package](../../../../packages/host/pto-artifact-inspection/README.md) profiles explicit user-selected directories, returns action readiness, and serves supported static HTML through revocable exact-file routes. The workspace overlay consumes those routes. The run recognizer owns artifact facts; the Host owns registration, revision checks, routes, and analysis admission.

Qualified Skill lookup binds provider and revision. The dependency tool requires an admission receipt and uses a configured pinned upstream tool. The outer workbench supplies the official Skill resource closure, tool bytes, provenance, and deployment patch; those resources are independently versioned.

## Alternatives considered

**Serve the selected directory.** Rejected because a viewer needs one approved file, not access to sibling files or arbitrary path traversal.

**Select a Skill by display name alone.** Rejected because another provider can publish the same name without the pinned tool and revision relationship.

**Copy upstream analysis logic into the client.** Rejected because the official tool remains the algorithm owner and the client only presents profiles and views.

## Consequences

Static viewing does not materialize a Session. Route disposal revokes access, and unsupported adapters report unavailable. Records and admission maps remain process-local; selection callbacks and durable analysis views are absent.

The Viewer-to-composer first-send path has a known regression: browser composition can lose structured analysis identity and send plain text without reaching Host admission. Successful Host and controller unit tests do not establish an end-to-end analysis success. New-launch versus retry behavior and the custom experiment view width remain separate repair work; this baseline does not fix them.

## Testing

Nine focused Host, Skill, run-profile, workspace, conversation, and layout test files pass 223 cases during baseline capture. These tests use controlled plugin compositions; a recorded-session scenario and a real browser test covering the complete first-send transaction remain missing. The subsequent analysis-launch repair owns that gap.
