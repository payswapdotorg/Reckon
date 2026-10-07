# Reckon-Complete Simulation Ladder

Status: ACTIVE PROGRAM SPECIFICATION
Owner: TL3 + W1 + W2 + W3

## Purpose

Run Reckon against an increasing ladder of host-system archetypes to discover the smallest stable public API/SDK surface that lets an external product become Reckon-Complete without modifying Reckon core.

Every simulation records host inputs, Reckon outputs, API/SDK calls, host glue code, custom adapter work, configuration, latency, failures, missing capabilities, and evidence class.

## Reckon-Complete definition

A host is Reckon-Complete for a declared profile when it can exercise the required Reckon decision loop using only public contracts, generated schemas, API/SDK surfaces, and a declared capability manifest, with zero internal-package imports and no domain logic added to the Reckon kernel.

Reckon-Complete is profile-based. The host declares required capabilities; Reckon returns the required contract/capability set; the conformance harness proves coverage.

## Ladder

1. Static catalog picker — query a small catalog and return the best item.
2. Simple content feed — preferences, context, outcomes and queue/replace.
3. E-commerce storefront — variants, price, availability, constraints, conversion.
4. Notification system — attention, fatigue, time windows, defer/queue, interruption.
5. Media streaming — current/next experience, switching, resume, rolling plans.
6. Ad-supported media — placements, formats, pacing, interruption, rights and consent.
7. Marketplace — seller/offer/item separation, competing objectives, uncertain inventory.
8. Travel / booking — coupled itinerary constraints, availability, cancellation, replanning.
9. Food delivery — changing ETA, substitutions, urgent replanning, hard deadlines.
10. Mobility / ride-hailing — real-time matching, spatial context, scarce resources, tight latency.
11. Social feed — large candidate sets, freshness, exploration, strong policy boundaries.
12. Finance / offers — strict eligibility, auditability, host suitability/policy constraints.
13. Healthcare information — high-stakes uncertainty, provenance, consent, host safety gates.
14. Education — long-horizon goals, curriculum state, delayed outcomes, sequential planning.
15. B2B SaaS workspace — roles, teams, workflow context, multi-actor objectives.
16. Enterprise workflow orchestration — approvals, long-lived plans, concurrency, audit, compensation.
17. Multi-agent operations — Agent Organizations, delegation, budgets, termination, single-agent baseline.
18. Multi-surface realtime system — web/mobile/device bodies, cross-surface plans, explicit cross-device consent.
19. Resource-constrained adaptive system — CPU/API/money/time/attention budgets and graceful degradation.
20. Adversarial/uncertain environment — stale/noisy data, provider failure, delayed outcomes, capability churn and recovery.

## Measurement

Every level records:
- API operations and SDK methods required.
- host-side glue functions and custom adapter LOC.
- internal Reckon access (must be zero).
- time/steps to first decision and full-loop completion.
- p50/p95 latency and failure/retry behavior.
- declared versus supported capability coverage.
- evidence class: fixture, controlled-local, staging, production-observed, simulated or counterfactual.
- friction category: CONTRACT_GAP, API_GAP, SDK_GAP, COMPOSITION_GAP, PERSISTENCE_GAP, CAPABILITY_GAP, ADAPTER_GAP, OBSERVABILITY_GAP, UX_DX_GAP, HOST_RESPONSIBILITY, RIGHTS_POLICY_BOUNDARY.

Repeated gaps across domains are platform-upgrade candidates.

## Worker execution

TL3 owns the benchmark definition, conformance profile, public contract evolution, recurring-gap analysis, architecture changes, cross-wave reconciliation and final acceptance.

W1 owns synthetic host state, context/preferences/events, world-state transitions, delayed/partial observations, uncertainty injection and simulation metrics.

W2 owns decision/experience/scheduler integration, interruption/switching cases, resource budgets, agent-body/organization cases and single-agent baselines.

W3 owns API-only drivers, SDK onboarding, capability manifests, request/response measurement, conformance checks, failure/retry harnesses and safe external-wire validation.

## Parallel waves

Wave A: W1 Levels 1–4; W2 Levels 5–8; W3 builds the common API-only onboarding and measurement harness.
Wave B: W1 Levels 9–12; W2 Levels 13–16; W3 validates the public API/SDK across representative levels.
Wave C: W1 Levels 17–20 state/noise/outcome environments; W2 Levels 17–20 agent/runtime behavior; W3 API-only and external-wire verification; TL3 reconciles.

When the same gap appears in at least three domains, upgrade the common platform primitive and replay earlier levels. The goal is measurable reduction in host integration effort.

## Target onboarding

New hosts should converge toward: register a capability manifest; connect identity/catalog/context/outcome sources; declare objectives/constraints/delivery capabilities; call the standard API/SDK; receive decisions/experiences/plans/actions; return outcomes; retrieve evidence; run conformance; become Reckon-Complete.

The host should not need to understand Reckon's internal package graph.

## Architecture laws

Do not create a second ranking, policy or scheduler. Keep identity, catalog, rights, entitlements, delivery and legal/policy authority host-owned. Simulation is not production evidence. Simulated/counterfactual outcomes never masquerade as observed. Public availability never implies reuse rights. Sensitive personal attributes are never silently inferred for optimization.

## Required final artifacts

docs/simulations/reckon-complete-matrix.json
docs/simulations/reckon-complete-report.md
generated conformance fixtures
public API/SDK contract upgrades
Architecture Change Records where required
minimal API-only onboarding example demonstrating a new host becoming Reckon-Complete.

## Success criterion

The ladder succeeds when increasing domain complexity changes the host-declared profile more often than it changes Reckon-specific integration code, and marginal host effort to become Reckon-Complete falls as the platform matures.