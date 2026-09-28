# Implementation Rules

## Vertical-first

The first implementation target is:

`context → candidates → experience → decision → schedule → outcome → preference delta`

Do not start by building a demo UI or a provider-specific recommendation product.

## Contract-first

TL3 freezes canonical shared contracts before worker implementation.

Workers consume those contracts and may not silently create competing types.

## Provider-neutral core

The decision, experience, scheduler, preference and simulation kernels contain no provider-specific branches.

## Host authority

The host owns identity, consent, catalog, provider access, rights/entitlements, delivery/playback, payment and policy.

## Two-speed execution

Fast runtime:
- low latency;
- no required LLM call;
- deterministic enough to debug and audit.

Research runtime:
- durable;
- resumable;
- seeded;
- budgeted;
- artifact-versioned;
- explicit about counterfactuals.

## Evidence

Never use:
- fixtures as live-provider evidence;
- simulated outcomes as observed outcomes;
- unit-test counts as product acceptance.

## Changes

Locked architecture changes require an Architecture Change Record before implementation proceeds.

## Worker isolation

Worker-owned paths are exclusive. A shared-path conflict goes to TL3 instead of being resolved by editing around the boundary.
