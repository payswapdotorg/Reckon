# Level 8 — Travel / Booking (SIM-003 integration case)

Ladder: "coupled itinerary constraints, availability, cancellation, replanning"
Host: **VoyageEasy** (`host-voyageeasy`, tenant `tenant-voyageeasy`, subject `user-traveler-31`)
Profile: `profile-level-8-travel-booking` (12 required capabilities, evidence floor `fixture`)
Fixture: `tests/conformance/fixtures/integration-cases/level8-travel.ts`

## Domain mapping onto the frozen contracts

| Domain concept | Contract surface |
|---|---|
| Itinerary leg / stay / activity | `CatalogItem` kind `commerce` (labels: flight/hotel/activity; `availableFrom`/`availableUntil` windows on flights) |
| Booking class / rate plan / activity slot | `Realization` kinds `booking-class` / `rate-plan` / `activity-slot` (cabin, seatsLeft, roomType, nights, slot, priceCents) |
| Coupled-leg constraints | `custom` hard constraint `itinerary-leg-coupling` (minConnectionMinutes 90, maxLayoverMinutes 300 — host rule, opaque to the kernel) |
| Activity window | `time-window` hard constraint (morning window in virtual clock ms) |
| Budget ceiling | `max-cost` hard constraint (120000¢ → 80000¢ as the budget tightens) |
| Itinerary (rolling plan) | `DecisionRequest.planId` ↔ `ScheduleDelta.planId` (`plan-voyageeasy-acc-jnb`, `plan-voyageeasy-budget`) |
| Booking objective | `Objective` kind `custom`, customKind `book-trip` (origin/destination/travelers params) |
| Carrier cancellation | append-oriented `correction` outcome (`correctsEventId` → the original booking outcome; corrections never overwrite) |
| Time-critical rebooking | candidate source `host-time-critical` ⇒ INTERRUPT |
| Resume planning | candidate source `host-resume` ⇒ RESUME |

## Scenarios and measured runs (virtual clock)

| Scenario (archetypes) | Steps | Seed | Glue (fn/loc/adapter) | First decision | Full loop | p50/p95 (ms) | Samples | Coverage | Complete |
|---|---|---|---|---|---|---|---|---|---|
| itinerary-assembly (replan, switching) | 5 | 17917286180745078600 | 7/111/108 | step 1 @ 334ms | step 1 @ 398ms | 24/47 | 29 | 12/12 | ✅ |
| availability-switching (switching) | 5 | 2263179953189756647 | 7/105/102 | step 1 @ 286ms | step 1 @ 346ms | 22/49 | 28 | 12/12 | ✅ |
| cancellation-recovery (interruption, resume, replan) | 5 | 6639422811749917418 | 7/113/110 | step 1 @ 324ms | step 1 @ 383ms | 22/48 | 28 | 12/12 | ✅ |
| budget-replan (replan, switching) | 6 | 14001032077641412614 | 7/130/127 | step 1 @ 263ms | step 1 @ 338ms | 29/47 | 31 | 12/12 | ✅ |
| probe-plan-management (replan) | 5 | 13052267676906419677 | 7/111/108 | step 1 @ 227ms | step 1 @ 303ms | 19/44 | 29 | 12/13 (partial) | ❌ by design |
| resilience (replan, switching; faultRate 0.2, 3 retries) | 6 | 5094225565517092896 | 7/130/127 | step 1 @ 606ms | step 1 @ 665ms | 31/110 | 30 | 12/12 | ✅ |

Evidence class of every run: `fixture`. Internal imports: 0. API operations / SDK methods: the six standard-loop operations (from the call log).

## Scenario semantics (asserted by the acceptance suite)

- **itinerary-assembly** — `QUEUE → QUEUE → QUEUE → SWITCH → CONTINUE` with `planId` on every delta: sequential leg decisions assemble a three-leg itinerary (outbound flight, hotel, morning activity) under coupled-leg and budget constraints; a cheaper via-LOS outbound is rebooked mid-planning — the SWITCH dequeues the original leg and enqueues the replacement while the queue keeps all three legs.
- **availability-switching** — `QUEUE → SWITCH → SWITCH → SWITCH → CONTINUE`: the standard rate plan sells out; the same-item realization SWITCH moves to the lodge's alternate rate plan (`inventory-replan` custom outcome); the activity leg is gated by the morning `time-window` constraint; conversions book the flight and the activity.
- **cancellation-recovery** — `QUEUE → QUEUE → INTERRUPT → RESUME → CONTINUE`: the carrier cancels the booked flight — the rebooking decision INTERRUPTs the plan (the cancelled leg is dequeued from the itinerary, the replacement enqueued, a checkpoint kept), and the booking outcome is CORRECTED append-oriented (`correctsEventId` → the original step-1 booking outcome; corrections reference, never overwrite). Planning RESUMEs on the hotel leg and it converts.
- **budget-replan** — `QUEUE → QUEUE → SWITCH → SWITCH → SWITCH → CONTINUE` with `planId` throughout: the budget ceiling tightens 120000¢ → 80000¢; the whole itinerary replans via rate swap (21000¢ → 15500¢), outbound rebook (82000¢ → 68000¢) and activity selection, ending within budget (`totalCents 88000, withinBudget 1`).

## Capability coverage and findings

Baseline coverage: 12/12 (the standard loop; `constraint-declaration` carries the coupled/budget/window gates; `schedule-execution` carries leg swaps, interrupt and resume).

### Friction findings (named gaps)

| Category | Capability | Finding |
|---|---|---|
| `COMPOSITION_GAP` | `plan-management` | Itineraries are rolling host-owned plans; decisions couple via `planId` and the SDK/API expose `plans.create/replan/get/history` (with replan triggers — `candidate-unavailable`, `budget-exhausted` map exactly onto this level's scenarios), but the SIM-001 harness port composes only the standard decision loop. Probed: verdict honestly incomplete, gap recorded (`rec-fe602623aac89f49`). With L5's probe this gap now appears in TWO domains — one more and the 3-domain law triggers the port-composition upgrade. |
| `HOST_RESPONSIBILITY` | — (outcome-return / candidate-retrieval, exercised) | Bookings, inventory and corrections are host-owned state: the host books legs (conversion outcomes), observes sell-outs (custom outcomes), and corrects cancellations append-oriented. The public surface carries the semantics without Reckon becoming a booking authority. |
| `CONTRACT_GAP` (observation, not probed) | — (constraint-declaration) | Coupled itinerary constraints (connection windows, same-traveler leg coupling) ride `custom` constraints with host-interpreted params; a first-class coupled-constraint kind (leg-pair timing) would remove adapter-side encoding. Watch-list item for the recurring-gap register. |

### Resilience (seeded fault storm)

faultRate 0.2, maxRetries 3: 17 failed attempts, 16 recovered by classified bounded retries and **1 call exhausted its retry budget** — honestly recorded in the run record (`exhaustedCount: 1`) while the decision loop still completed (first decision and full loop at step 1; p95 rose to 110 virtual ms). The exhausted surface call did not crash the run — the driver's resilience semantics (record and continue) held.

## Limitations

Fixture-class evidence: availability transitions and carrier cancellations are scripted-world state; the responder honors declared constraints deterministically rather than evaluating them against live inventory. See the wave README.
