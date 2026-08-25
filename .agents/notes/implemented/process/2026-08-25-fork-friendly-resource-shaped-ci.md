# Agent Note: Fork-friendly resource-shaped pull-request CI

Status: implemented

English | [中文](2026-08-25-fork-friendly-resource-shaped-ci.zh.md)

## Problem

Seven pull-request jobs target named 16-core Linux and Windows runners owned by the canonical repository. GitHub forks do not inherit those runners, repository variables, or self-hosted pools. Running the unchanged workflow in a fork therefore leaves the checks queued forever with no runner, obscures the checks that did run, and prevents the aggregate verdict from completing.

The resource budgets and concurrency settings of these jobs are part of the canonical CI topology. Transparently moving their exhaustive suites onto smaller public runners would change that contract and could produce timeouts or misleadingly different coverage.

## Decision

[Pull-request CI](../../../../.github/workflows/ci.yml) keeps the existing check names in every repository. In `deepseek-ai/deepseek-harness`, the three Linux jobs and four split native Windows jobs retain their named larger-runner and self-hosted failover selectors, and every setup and gate step remains canonical-only.

In forks, each of those jobs selects `ubuntu-latest` and runs one explicit successful step explaining that the canonical larger runner is not inherited and upstream CI owns the exhaustive gate. Forks do not check out code, install dependencies, restore caches, prepare sandboxes, or execute the resource-shaped suites in those seven jobs. The three blocking Linux no-ops and required Windows no-ops still feed `all checks passed`, allowing the aggregate verdict to finish while preserving the stable check names.

Standard hosted compatibility, SDK, release-shaped runtime, and Wine jobs continue to run in forks. Local validation and later canonical-repository CI remain responsible for the exhaustive static, coverage, snapshot/artifact, and native Windows signals.

## Verification

[Workflow tests](../../../../scripts/ci-workflow.spec.ts) pin the public fork runner, the explicit no-op, the absence of a repository-level job skip, and the canonical repository gate on every resource-shaped step. They also retain the assertions for the canonical Linux and Windows failover selectors and aggregate dependencies.

## Alternatives considered

**Leave the jobs queued.** The fork cannot acquire the canonical runner labels, so waiting does not add validation and leaves the PR in a permanently incomplete state.

**Run the exhaustive suites on standard public runners in forks.** This appears more complete, but the suites and concurrency budgets were designed for 16-core runners; changing hardware silently makes the signal slower and less comparable and can exceed hosted limits.

**Remove the seven jobs from fork workflows.** This avoids the queue but changes check visibility and the aggregate dependency graph. Explicit no-ops preserve stable names and make the repository boundary visible in the log.

**Register matching self-hosted runners in every fork.** That reproduces the canonical topology at substantial operational and security cost and is not a reasonable prerequisite for contributors.

## Consequences

Fork pull requests finish instead of waiting indefinitely for unavailable infrastructure, and their logs say exactly which exhaustive checks were not executed. A green fork result does not claim that the seven resource-shaped suites ran; upstream CI or disclosed local validation must supply that evidence.

The canonical repository's runner selection, failover controls, and test inventory are unchanged. The workflow repeats repository guards on the affected steps, which is verbose but mechanically testable and prevents a future setup or gate step from accidentally running in forks.
