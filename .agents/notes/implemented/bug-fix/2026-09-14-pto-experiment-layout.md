# Agent Note: PTO experiment content width

Status: implemented

English | [中文](2026-09-14-pto-experiment-layout.zh.md)

## Problem

An independent fixed dashboard width ignores the user's Conversation width. Long grid items and footer controls overflow when the resource sidebar narrows the view. An independent nested scroller can obscure which owner reserves the composer seat.

## Decision

The experiment plugin consumes the existing Conversation content-width and measured composer-height variables. Its list uses a constrained grid track and inline-size container queries for fact columns. Header and footer controls wrap within the available width, while long values retain their full tooltips. The dashboard remains in the Conversation scroll flow, where the sticky composer has its own seat; card scroll margins use its live height.

## Alternatives considered

**Viewport breakpoints.** They cannot detect narrowing by the resource sidebar or the user's content-width handles.

**ConversationRoot changes.** The shell already publishes the required measurements. The plugin owns card layout; Conversation owns the scrollport and composer seat.

## Consequences

Experiment cards follow the same width preference as Chat. The dashboard has its own container without adding containment to the Conversation shell. Host execution, durable records, model context, and comparison-result presentation remain unchanged.
