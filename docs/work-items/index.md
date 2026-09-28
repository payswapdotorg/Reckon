# Reckon Work Items

Status: initial TL3 dispatch set

| ID | Owner | Depends on | Parallel? | Acceptance |
|---|---|---|---|---|
| ARCH-001 | TL3 | none | — | architecture + lock reviewed |
| CONTRACT-001 | TL3 | ARCH-001 | — | schemas/versioning/digest rules frozen |
| ADR-001 | TL3 | ARCH-001 | — | persistence/event model frozen |
| ADR-002 | TL3 | ARCH-001 | — | model adapter boundary frozen |
| ADR-003 | TL3 | ARCH-001 | — | consent/privacy boundary frozen |
| ADR-004 | TL3 | ARCH-001 | — | runtime/research split frozen |
| W1-001 | W1 | CONTRACT-001 | yes | event ingestion contract tests |
| W1-002 | W1 | CONTRACT-001 | yes | context state tests |
| W1-003 | W1 | CONTRACT-001 | yes | preference delta tests |
| W1-004 | W1 | CONTRACT-001 | yes | feature assembly tests |
| W1-005 | W1 | W1-004 | yes | world-model input/output |
| W1-006 | W1 | W1-005 | yes | deterministic sequential simulator |
| W1-007 | W1 | W1-006 | yes | offline policy evaluation |
| W1-008 | W1 | W1-007 | yes | contextual-bandit evaluation |
| W1-009 | W1 | W1-006,W1-008 | limited | sequential RL environment |
| W1-010 | W1 | W1-009,outcomes | limited | calibration/robustness |
| W2-001 | W2 | CONTRACT-001 | yes | candidate normalization |
| W2-002 | W2 | W2-001 | yes | policy evaluation |
| W2-003 | W2 | W2-001 | yes | experience expansion |
| W2-004 | W2 | W2-001 | yes | scheduler |
| W2-005 | W2 | W2-004 | yes | switch/interruption evaluator |
| W2-006 | W2 | W1-002,W1-003 | yes | Personal Agent runtime |
| W2-007 | W2 | CONTRACT-001 | yes | Agent Body runtime |
| W2-008 | W2 | W2-007 | yes | Agent Organization runtime |
| W2-009 | W2 | W1-009,W2-008 | limited | organization search |
| W3-001 | W3 | CONTRACT-001 | yes | API skeleton |
| W3-002 | W3 | W3-001 | yes | SDK |
| W3-003 | W3 | W3-001 | yes | event/outcome transport |
| W3-004 | W3 | W3-001 | yes | observability |
| W3-005 | W3 | W2-002,W2-003 | yes | WebFlix reference adapter |
| W3-006 | W3 | W2-002,W2-003 | yes | generic media reference adapter |
| W3-007 | W3 | W2-002,W2-003 | yes | commerce reference adapter |
| W3-008 | W3 | W2-002,W2-003 | yes | advertising reference adapter |
| W3-009 | W3 | W3-005..008 | no | cross-domain E2E |
| W3-010 | W3 | W3-009 | no | performance envelope |
| W3-011 | TL3+W3 | all core | no | production-readiness evidence |

## First implementation target

The first end-to-end vertical slice should be media-neutral:

`context → candidates → experience → decision → schedule → outcome → preference delta`

Only after that slice is real should domain adapters be accepted as production-capable.

## Critical acceptance principle

A passing unit-test battery is not evidence that a real external provider path works.

Every adapter must declare:

- supported capabilities;
- unsupported capabilities;
- authorization requirements;
- rate/latency limits;
- actual live verification status;
- data/right provenance;
- failure semantics.
