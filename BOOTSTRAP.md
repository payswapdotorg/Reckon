# Reckon Bootstrap

This is the first operational entrypoint for any fresh clone.

## Read order

1. `AGENTS.md`
2. `docs/handoff/TL6-FINAL-HANDOFF.md`
3. `docs/handoff/TL3-HANDOFF.md`
3. `docs/architecture/architecture-lock.md`
4. `docs/architecture/reckon-frozen-architecture.md`
5. `docs/architecture/contracts.md`
6. `docs/architecture/dependency-graph.md`
7. `docs/architecture/public-contract-map.md`
8. `docs/decisions/ADR-001-persistence-events.md`
9. `docs/decisions/ADR-002-model-adapter.md`
10. `docs/decisions/ADR-003-consent-privacy.md`
11. `docs/decisions/ADR-004-runtime-research.md`
12. `docs/work-items/index.md`
13. `docs/work-items/state.json`
14. `docs/work-items/tl3-work-order.md`
15. `docs/handoff/implementation-context.md`

No knowledge outside this repository is required to understand the approved product direction.

## Repository truth

The active phase is authoritative in `docs/handoff/TL6-FINAL-HANDOFF.md` and `docs/work-items/state.json`. Historical handoffs remain useful context but cannot override the active state. Implementation state is never inferred from an older release marker.

Implementation state is authoritative only when supported by repository commits, tests, runtime evidence and the work-item state.

## Local bootstrap

Requirements:

- Git
- Node.js satisfying `engines.node` in `package.json`
- pnpm

Run:

`pnpm install`
`pnpm check`

The initial scaffold is intentionally light. TL3 freezes the exact toolchain/lockfile and generated-schema mechanism before worker implementation.

## First TL3 actions

1. Verify origin/main SHA.
2. Read and acknowledge the architecture lock.
3. Verify the complete work-item state.
4. Freeze canonical schemas and versioning.
5. Freeze package/dependency/toolchain details.
6. Create three worker branches from one dispatch SHA.
7. Record dispatch SHAs in `docs/work-items/state.json`.
8. Dispatch the independent first-wave work items.

## Worker startup

Every worker must read `AGENTS.md`, the worker handoff, architecture lock, canonical contracts and prerequisites before editing.

Workers verify the dispatch SHA and inspect the repository before coding.

A worker must stop and raise an Architecture Change Record when a locked decision would need to change.

## Completion

A worker completion report must identify:

- exact base SHA;
- exact final SHA;
- exact owned-path diff;
- commands and exit codes;
- acceptance mapping;
- limitations;
- unresolved questions;
- evidence class: fixture, controlled/local, staging, or production-observed.

Workers never merge.

## Final rule

The repository, not an external conversation, is the source of truth.