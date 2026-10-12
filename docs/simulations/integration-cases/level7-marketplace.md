# Level 7 — Marketplace (SIM-003 integration case)

Ladder: "seller/offer/item separation, competing objectives, uncertain inventory"
Host: **MarketBridge** (`host-marketbridge`, tenant `tenant-marketbridge`, subject `user-shopper-21`)
Profile: `profile-level-7-marketplace` (12 required capabilities, evidence floor `fixture`)
Fixture: `tests/conformance/fixtures/integration-cases/level7-marketplace.ts`

## Domain mapping onto the frozen contracts

| Domain concept | Contract surface |
|---|---|
| Product (the item) | `CatalogItem` kind `commerce` |
| Seller offer (the way the product is delivered) | `Realization` kind `seller-offer` (sellerId / priceCents / currency / shippingDays / stock constraints) — one product, MANY offers |
| Competing objectives | `RewardSpec` (versioned, multi-term, declared per request): buyer value (`satisfaction-proxy` 0.6 / `conversion` 0.3 / `revenue` 0.1 / `policy-risk` −0.05), marketplace mix (revenue 0.5), trust mix (policy-risk −0.3) — constraints stay separate from reward (lock #21) |
| Budget ceiling | `max-cost` hard constraint (currency USD) |
| Uncertain inventory | offer stock in realization constraints + candidate drop-out + host-side inventory state |
| Offer swap (same product, better offer) | same `itemId`, different realization ⇒ SWITCH (the schedule policy's realization check) |
| Flash-deal urgency | candidate source `host-time-critical` ⇒ INTERRUPT (checkpoint the browsing state) |
| Resume browsing | candidate source `host-resume` ⇒ RESUME |

## Scenarios and measured runs (virtual clock)

| Scenario (archetypes) | Steps | Seed | Glue (fn/loc/adapter) | First decision | Full loop | p50/p95 (ms) | Samples | Coverage | Complete |
|---|---|---|---|---|---|---|---|---|---|
| offer-selection (switching) | 5 | 2608406624247815649 | 7/111/108 | step 1 @ 327ms | step 1 @ 407ms | 26/46 | 30 | 12/12 | ✅ |
| competing-objectives (switching) | 5 | 14091982014319908214 | 7/110/107 | step 1 @ 271ms | step 1 @ 364ms | 27/48 | 29 | 12/12 | ✅ |
| uncertain-inventory (replan, switching) | 6 | 10867514083901870869 | 7/123/120 | step 1 @ 334ms | step 1 @ 388ms | 22/47 | 33 | 12/12 | ✅ |
| deal-interruption-resume (interruption, resume) | 5 | 17731474482795683583 | 7/103/100 | step 1 @ 334ms | step 1 @ 360ms | 18/49 | 29 | 12/12 | ✅ |
| probe-decision-retrieval (switching) | 5 | 5919620538704679615 | 7/111/108 | step 1 @ 357ms | step 1 @ 376ms | 23/47 | 30 | 12/13 (partial) | ❌ by design |
| resilience (replan, switching; faultRate 0.2, 3 retries) | 6 | 2199664778980603172 | 7/123/120 | step 1 @ 544ms | step 1 @ 579ms | 27/91 | 33 | 12/12 | ✅ |

Evidence class of every run: `fixture`. Internal imports: 0. API operations / SDK methods: the six standard-loop operations (from the call log).

## Scenario semantics (asserted by the acceptance suite)

- **offer-selection** — `QUEUE → SWITCH → CONTINUE → SWITCH → CONTINUE`: the item/offer/decision vertical. The same-product offer swap (seller-a 18900¢ → seller-b 17900¢) is a **SWITCH** (different realization), keeping a checkpoint of the abandoned offer card; the same-offer re-decision is a **CONTINUE**; purchases are `conversion`/`purchase` outcomes with numeric offer metrics.
- **competing-objectives** — `QUEUE → SWITCH → SUGGEST → CONTINUE → SWITCH`: the declared reward mix shifts buyer → marketplace → trust across steps; retrieval order follows; trust mode turns the lamp promotion into a mindful SUGGEST. Clean runs prove every multi-term reward spec validated against the frozen contract through the real SDK (invalid rewards would fail terminally — none did).
- **uncertain-inventory** — `QUEUE → SWITCH → CONTINUE → SWITCH → SWITCH → CONTINUE`: a low-stock lamp sells out (abandonment outcome with substitution metrics), the keyboard substitutes and converts, a `max-cost` budget ceiling gates the headphones, the budget cut + restock triggers an `inventory-replan` (custom outcome) onto the restocked lamp offer, which converts.
- **deal-interruption-resume** — `QUEUE → INTERRUPT → CONTINUE → RESUME → CONTINUE`: a time-critical flash-deal offer (6900¢ keyboard realization) interrupts desk browsing (checkpoint kept), converts, and browsing resumes to purchase.

## Capability coverage and findings

Baseline coverage: 12/12 (the standard loop; `constraint-declaration` carries budget ceilings, `schedule-execution` carries offer swaps and interrupt/resume).

### Friction findings (named gaps)

| Category | Capability | Finding |
|---|---|---|
| `COMPOSITION_GAP` | `decision-retrieval` | Marketplace audit and offer-provenance lookup want `GET /v1/decisions/{id}` with `?expand[]` (SDK-exposed); the SIM-001 harness port composes only the six standard-loop operations. Probed: verdict honestly incomplete, gap recorded (`rec-b0d3d511a113d47d`). |
| `HOST_RESPONSIBILITY` | — (candidate-retrieval / outcome-return, exercised) | Seller/offer/inventory authority is host-owned: the catalog and offers are host state; stock transitions and substitutions are host-observed outcomes. The public surface carries them (realization constraints, candidates, outcomes) without Reckon becoming the inventory authority. |
| `CONTRACT_GAP` (observation, not probed) | — (objective-declaration) | Marketplace fairness constraints (e.g. seller exposure caps) map onto `custom` constraints + reward terms today; a first-class fairness constraint kind would remove adapter-side encoding. Not yet a 3-domain finding — recorded for the recurring-gap watch. |

### Resilience (seeded fault storm)

faultRate 0.2, maxRetries 3: 7 failed attempts, all recovered (0 exhausted), loop completed at step 1, p95 rising to 91 virtual ms across the inventory-replan sequence.

## Limitations

Fixture-class evidence: the scripted responder preserves host candidate order (it does not re-rank by the declared reward — the fixture proves the reward spec CROSSES the public surface and validates, not that the engine optimizes it). Stock transitions are scripted-world state. See the wave README.
