# Reckon Agent Governance

## Source of truth

The repository is the only canonical source for Reckon architecture and implementation status.

Do not rely on chat summaries, issue descriptions, screenshots, worker claims, generated reports, or test counts without verifying the repository and the actual commands/evidence.

For an active phase, read `docs/handoff/TL6-FINAL-HANDOFF.md` and `docs/work-items/state.json`. Those repository artifacts define the active mission and status; historical documents cannot override them.

## Roles

### Tech Lead (TL3)

The Tech Lead owns:

- architecture lock;
- public contract changes;
- dependency ordering;
- shared schemas and generated clients;
- composition roots;
- worker boundary conflicts;
- final merge/reconciliation;
- acceptance evidence;
- release readiness.

Workers implement only their assigned surfaces and do not merge their own work.

### Worker 1 — Data + Context + Simulation

Own:

- catalog/event ingestion contracts and adapters;
- personal/audience state representation;
- feature derivation;
- world-model and simulation infrastructure;
- offline datasets and evaluation harnesses.

Do not own runtime composition or public API routing.

### Worker 2 — Decision + Agent Runtime

Own:

- candidate evaluation;
- policy engine;
- experience resolution;
- scheduler/interruption logic;
- Agent Body and Agent Organization runtime/search contracts;
- model/provider adapter seam.

Do not own UI, provider-specific product integrations, or final composition roots.

### Worker 3 — SDK + Integrations + Proof

Own:

- consumer SDKs/API surface;
- reference adapters;
- observability/telemetry contracts;
- end-to-end integration fixtures;
- compatibility and acceptance harness;
- developer experience.

Do not modify Worker 1 or Worker 2 domain internals except through frozen contracts.

## Parallelization rule

Workers may proceed concurrently when they depend only on frozen contracts.

Shared types are changed only by TL3.

Each work item declares:

- owner;
- owned paths;
- prerequisites;
- outputs;
- acceptance tests;
- forbidden dependencies.

## Evidence classes

Every material statement in repository docs should be tagged where useful:

- OBSERVED — verified from code/runtime.
- DOCUMENTED — stated by an authoritative external source.
- HYPOTHESIS — architectural hypothesis.
- REPRODUCED — reproduced locally or in a controlled harness.
- UNRESOLVED — requires future validation.

## Production truth

Architecture correctness is not production acceptance.

A provider path is not accepted until:

1. real capability is verified;
2. authorization/credentials are real;
3. actual output is observed;
4. relevant latency/failure behavior is measured;
5. no fixture or mock is substituting for the production path.

## Safety and policy

Reckon must never:

- bypass DRM, authentication, access controls, CAPTCHA, rate limits, geo restrictions, or provider security;
- fabricate engagement;
- optimize deceptive or inauthentic behavior;
- use public content as presumed permission for reuse;
- silently infer sensitive personal attributes;
- silently turn an attention optimization into a maximum-engagement objective.

The host product remains responsible for its own legal, rights, safety, and policy gates.

## External dependencies

OpenMuse/OpenBot/CopilotKit may be evaluated as implementation substrates, but none is a Reckon architectural authority.

External code must remain behind bounded interfaces and must not introduce a second model router, identity authority, policy authority, or recommendation authority.

## Worker completion

A worker may claim completion only with:

- exact base SHA;
- exact final SHA;
- owned-path diff;
- test/build output;
- limitations;
- acceptance mapping;
- explicit unresolved items.

Workers do not merge.
