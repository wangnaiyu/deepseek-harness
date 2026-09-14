# Agent Note: PTO analysis references

Status: implemented

English | [中文](2026-09-14-pto-analysis-references.zh.md)

## Problem

A plain question does not expose the selected Skill or Record. A cwd-relative file mention cannot identify an external PTO Record. Adding a canonical Skill gesture also invokes the normal Skill injector beside PTO admission, producing duplicate instructions.

## Decision

Conversation persists text and reference occurrences as browser interaction state. It reconstructs the same editor nodes used by manual picks and supplies the captured projection to the submission owner. References dispatch optional source-owned activation through the ordinary input controller. Workspace owns the Record/revision resolver, visible-intent checks, and full record-plus-handle Viewer lifecycle. Successful staging closes the overlay. The canonical Skill gesture retains ordinary selection semantics; qualified identity remains enforced by Host admission.

The PTO pre-step listener prepends through Cordis so its result handling follows the normal Skill listener in both registration orders. It validates matching name/provider/body and produces one qualified injection. A conflicting definition rejects. No tool-skill implementation, receipt field, or Session format changes are required.

## Alternatives considered

**Plain @deps.json.** It loses atomic identity and falsely implies a Session-cwd file.

**DOM click interception.** It bypasses source ownership and keyboard lifecycle.

**Strip every same-name Skill message.** It hides provider conflicts instead of rejecting them.

## Consequences

New launches require the selected Skill and Record reference until admission. Users can edit the question, remove tokens and reselect them, or clear the draft before reassociation. Admitted question retries retain P2 identity rules. Legacy text-only P2 bindings remain readable. Host restart or changed Record revision can require reassociation; browser storage is not durable Session history. The focused composition tests cover manual selection, restoration, token refusal, handle replacement, and Skill conflicts. Actual-workbench evidence belongs to the repair task.
