# reckon — the Python reference client

A thin, Pythonic client for the [Reckon](../../README.md) API — the same
surface the [TypeScript SDK](../../packages/sdk) exposes, the same laws:

- **No model calls, no client-side policy** — pure plumbing over HTTP.
- **Pythonic surface, frozen wire** — snake_case kwargs in
  (`request_id=…` → `requestId` on the wire), snake_case attributes out
  (`decision.decision_id`).
- **Typed errors, never raw failures** — every failure raises
  `ReckonError` carrying the stable machine `code`; raw `requests`
  exceptions never escape.
- **One canonical webhook algorithm** — `verify_webhook` is the
  reference implementation published on the docs portal, byte for byte.

The only dependency is [`requests`](https://pypi.org/project/requests/).

## Install

The reference client is a single file — vendor it into your project:

```bash
cp sdks/python/reckon.py your_app/reckon.py
```

(A `pip install reckon` package follows the same source once published.)

## Quickstart

```python
import os
from reckon import ReckonClient

reckon = ReckonClient(
    api_key=os.environ["RECKON_API_KEY"],   # sk_test_… or sk_live_…
    base_url="https://api.reckon.dev",      # optional (the default)
    api_version="0.1.0",                    # optional X-Reckon-Version pin
)

decision = reckon.decisions.request(
    schema="reckon.decision-request",
    schema_version="0.1.0",
    request_id="req-1",
    tenant={"tenantId": "demo"},
    subject={"kind": "user", "ref": "usr_88213"},
    objective={"objectiveId": "obj_relax_evening", "kind": "relax"},
    attention_policy={"policyId": "att_balanced", "style": "balanced"},
    context={"contextId": "ctx-1"},
    candidates={
        "setId": "cs-1",
        "candidates": [{"itemId": "item-reef_doc", "source": "host-retrieval", "rankHint": 1}],
    },
    policy_selector={"policyId": "pol_evening_relax", "version": "3"},
    idempotency_key="idem-1",
)

print(decision.action)                       # "SUGGEST"
print(decision.selected_experience.item_id)  # "item-reef_doc"
print(reckon.last_mode)                      # "test" | "live" (X-Reckon-Mode)

# Close the loop — report what actually happened.
reckon.outcomes.append(
    schema="reckon.outcome-event",
    schema_version="0.1.0",
    event_id="evt-1",
    tenant={"tenantId": "demo"},
    decision_id=decision.decision_id,
    experience_id=decision.selected_experience.experience_id,
    subject={"kind": "user", "ref": "usr_88213"},
    event_type="completion",
    occurred_at=1769997721500,
    metrics={"watchedSeconds": 1180},
    evidence_class="production-observed",
    idempotency_key="idem-2",
)
```

Top-level kwargs are converted to the frozen camelCase contracts
(`schema_version` → `schemaVersion`). Nested structures are dicts
spelled exactly as the wire spells them (`{"tenantId": "demo"}`) — see
the [API reference](https://docs.reckon.dev) for every contract.

## Test mode

The mode lives IN the key (`sk_test_…` vs `sk_live_…`); every response
is mode-marked (`reckon.last_mode`, and `ReckonError.mode` on
failures). In test mode the decision path never executes live state —
a **magic item id** selects a canned scenario (the analogue of
Stripe's magic test card numbers):

```python
# itm_test_<scenario>: suggest · decline · hold · queue · continue ·
# switch · interrupt · resume · end · error
declined = reckon.decisions.request(..., candidates={
    "setId": "cs-2",
    "candidates": [{"itemId": "itm_test_decline", "source": "host-retrieval"}],
})
assert declined.action == "HOLD"
```

A **live** key presenting a magic item id (or any test-only hint) is
rejected with a typed `MODE_MISMATCH` (403) — never silently served.

## Webhooks

```python
from reckon import verify_webhook

# In your HTTP handler — use the RAW body, before JSON parsing:
if not verify_webhook(raw_body, request.headers["Reckon-Signature"], whsec):
    return 401  # let the retry schedule run; never process the unverifiable
```

The signature is HMAC-SHA256 over `"{t}.{raw_body}"` with the
endpoint's `whsec_…` secret, compared in constant time, with a
5-minute tolerance on `t` (the replay guard). Like the published docs
sample, a non-numeric `t` raises `ValueError` — catch it if you prefer
the boolean posture.

Endpoint management, the delivery log and replay:

```python
# Register — the ONE-TIME signing secret is issued at creation only.
endpoint = reckon.webhook_endpoints.create(
    "https://hooks.example.com/reckon", description="nightly reconciliation"
)
print(endpoint.secret)  # whsec_… — store it now, it never comes back

# Delivery log: one cursor page, or the auto-paginating generator.
page = reckon.webhook_deliveries.list(endpoint_id=endpoint.id, limit=20)
page.has_more, page.next_cursor
for delivery in reckon.webhook_deliveries.list_all(endpoint_id=endpoint.id):
    ...

# Events + replay (same event id, at-least-once — dedupe on event.id).
event = reckon.webhook_events.get(page.deliveries[0].event_id)
replay = reckon.webhook_events.replay(event.id)

# Housekeeping.
reckon.webhook_endpoints.list(limit=2)          # {endpoints, has_more, next_cursor}
reckon.webhook_endpoints.list_all()             # auto-paginating generator
reckon.webhook_endpoints.get(endpoint.id)
reckon.webhook_endpoints.delete(endpoint.id)
```

## Errors

```python
from reckon import ReckonClient, ReckonError, ErrorCodes

try:
    reckon.decisions.get("dec_unknown")
except ReckonError as error:
    error.code         # ErrorCodes.NOT_FOUND — the stable machine code
    error.status_code  # 404
    error.error_class  # "invalid_request_error" (the five stable classes)
    error.param        # the offending parameter, when the server names one
    error.doc_url      # the docs page for this code
    error.mode         # "live" | "test" — the failing request's mode
    error.retry_after  # Retry-After seconds on RATE_LIMIT_EXCEEDED (429)
```

Branch on `code`, never on messages. The catalog: `VALIDATION_ERROR`
(400), `UNAUTHENTICATED` (401), `TENANT_MISMATCH` (403),
`MODE_MISMATCH` (403), `INSUFFICIENT_SCOPE` (403), `NOT_FOUND` (404),
`IDEMPOTENCY_CONFLICT` (422), `RATE_LIMIT_EXCEEDED` (429), `NOT_WIRED`
(501), plus 500-family invariant codes. Client-side codes (`SDK_*`)
mark failures that never reached the server.

## Idempotency

- Routes whose contract carries `idempotency_key` **in the body**
  (decisions, outcomes) replay automatically when you reuse the key.
- Routes without a body-level key (webhook endpoint create, event
  replay) get an auto-generated `Idempotency-Key` **header** per call;
  pass `idempotency_key=…` to control it (e.g. safe retries from a
  queue worker).

## Surface (vs the TypeScript SDK)

| Capability | TypeScript `@reckon/sdk` | Python `reckon` |
| --- | --- | --- |
| Decisions + outcomes | ✔ | ✔ |
| Webhook endpoints / events / deliveries | ✔ | ✔ |
| Cursor pagination + auto-iterators | ✔ (`list`/`listPage`) | ✔ (`list`/`list_all`) |
| `?expand[]` | ✔ (`decisions.get`) | ✔ (`decisions.get(expand=…)`) |
| `apiVersion` pinning | ✔ | ✔ |
| Mode markers (`X-Reckon-Mode`) | ✔ (`lastResponseMode()`) | ✔ (`last_mode`) |
| Webhook signature verification | ✔ (`verifyWebhook`) | ✔ (`verify_webhook`) |
| Client-side contract validation (zod, both ways) | ✔ | — (server-side; typed errors) |
| Streaming (SSE) | future | not planned |

The Python client deliberately skips client-side schema validation:
the frozen zod schemas live in `@reckon/contracts`, and the server
validates every request anyway — failures surface as typed
`ReckonError`s with full envelope detail. The TypeScript SDK remains
the schema-validating reference.

## Tests

The suites are stdlib `unittest` and self-skip with named env gaps:

```bash
python3 test_verify_webhook.py   # the signature accept/reject matrix (no server)

# The docs-matrix suite needs a live server (the monorepo harness provides it):
RECKON_BASE_URL=http://… RECKON_TEST_KEY=sk_test_… RECKON_LIVE_KEY=sk_live_… \
    python3 test_reckon.py
```

In the monorepo, `packages/sdk/test/python-sdk.test.ts` boots the real
API on an ephemeral port and runs both suites as part of `pnpm test`.

## Examples

- [`examples/serve_recommendation.py`](examples/serve_recommendation.py) —
  the docs quickstart flow (decision → read → outcome) in test mode.
- [`examples/manage_webhooks.py`](examples/manage_webhooks.py) —
  endpoint CRUD, delivery log, event replay.
- [`examples/verify_webhook_handler.py`](examples/verify_webhook_handler.py) —
  a stdlib-only receiver that verifies every delivery and returns 2xx fast.
