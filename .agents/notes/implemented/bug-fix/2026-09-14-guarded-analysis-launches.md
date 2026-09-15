# Agent Note: Guarded analysis launches

Status: implemented

English | [中文](2026-09-14-guarded-analysis-launches.zh.md)

## Problem

A browser analysis launch must retain its Record and qualified Skill when preset discovery changes the draft target. A materialization-only trigger can skip admission after that change, and memory-only intent cannot recover after a browser reload.

## Decision

Conversation owns a generic owner/id/payload binding and validates it before default Session prompt delivery. Workspace owns PTO payload interpretation and calls the existing Host admission operation. Versioned browser interaction storage keeps pending/admitted identity and the unmaterialized draft text. Session transfer saves the receiving identity before removing the browser copy. Every retry revalidates with the Host; an admitted marker does not authorize sending by itself. Unknown owners and malformed state reject sending. Unsaved drafts require clearing before another launch; edits retain the binding. Each deliberate launch materializes a new Session, while retries keep its request and Session ids.

## Alternatives considered

**Materialization-only admission.** The captured draft revision can change before Send, and a Session retry bypasses that hook.

**Prefix matching.** Ordinary analysis questions do not invoke a slash trigger. Presentation text cannot establish admission identity.

**Receipt or Session-format changes.** Host admission already produces the required receipt and Skill source. Browser interaction recovery does not require another Session history or a receipt schema change.

## Consequences

Browser reload retains identity on the same origin. Clearing site data removes this interaction recovery state. Host restart can invalidate a registered Record; the UI preserves the question and directs the user to reassociate from the Viewer. This decision does not implement durable cross-device launch recovery or visible Skill/file tokens. The four-plugin assembly test covers preset/workspace drift, independent Viewer selection, single-flight materialization, rejection, same-Session retries, and intentional relaunch; the storage tests cover reload, cancellation, owner loss, and write failure. Actual Host/tool evidence belongs to the workbench repair task.
