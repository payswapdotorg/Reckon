# Reckon Architecture Lock

**Status:** FROZEN  
**Version:** 0.1  
**Owner:** TL3

## Locked decisions

1. Reckon is a standalone infrastructure product consumed by host products.
2. The primitive is `Item → Realization → Experience → Decision → Schedule → Outcome`.
3. Reckon is provider-neutral; provider-specific behavior is adapter-owned.
4. Host systems retain identity, consent, catalog/source-of-truth, entitlement, rights, delivery, payment/commerce and policy authorities.
5. Production decisioning and research/simulation are separate runtimes.
6. The fast runtime must not require an LLM for correctness.
7. One logical Personal Agent may span device-local bodies.
8. Cross-device learning requires explicit permission; derived learning state/deltas are the default sync primitive.
9. Ranking and interruption are separate policies.
10. Auto-playlists are represented as continuously replannable Experience Plans.
11. The scheduler may HOLD, CONTINUE, QUEUE, SUGGEST, SWITCH, INTERRUPT or RESUME.
12. The system must model interruption cost and resume loss.
13. Research supports supervised learning, contextual bandits/off-policy evaluation, offline policy learning, sequential RL, counterfactual/model-based planning and calibration.
14. A deterministic sequential simulation environment is required before promotion of RL/organization-search results.
15. A single generalist agent is a mandatory baseline for Agent Organization search.
16. Agent Bodies are model-neutral executable capability envelopes.
17. Agent Organizations are searchable graphs of Agent Bodies.
18. Reckon creates no second model router.
19. OpenMuse is an optional browser/computer-body substrate evaluation, not a core dependency.
20. Simulation/counterfactual output can never be represented as observed production evidence.
21. Hard constraints are separate from soft reward.
22. Engagement is not a universal objective.
23. Provider permissions/rights cannot be inferred from public URLs, account connections or catalog availability.
24. No worker owns merge/reconciliation of shared architecture surfaces.
25. TL3 owns final acceptance.

## Architecture change control

Any change to a locked decision requires an Architecture Change Record in the repository containing:

- rationale;
- affected contracts;
- dependency impact;
- migration path;
- worker impact;
- acceptance impact;
- security/privacy implications;
- explicit approval by TL3.

Workers must stop and surface an ACR when their implementation would require changing a locked decision.

## Completion standard

No feature is accepted merely because its local unit tests pass.

Acceptance requires repository evidence at the appropriate level:

`contract → implementation → integration → observed behavior → production evidence`

Fixture evidence must remain explicitly labeled as fixture evidence.
