"""Docs-matrix tests for the Python reference client — against the REAL API.

These tests run the flow the docs portal documents (quickstart +
webhooks + test mode) through ``reckon.ReckonClient`` against a real
Reckon API server:

    create key → test-mode decision → outcome → webhook endpoint CRUD
    → event retrieval → replay → delivery log → pagination → errors

ENV GAPS (self-skipping, the S2-002 convention): the tests need a live
server booted by the monorepo harness
(packages/sdk/test/python-sdk.test.ts), which injects:

    RECKON_BASE_URL   e.g. http://127.0.0.1:41234
    RECKON_TEST_KEY   an sk_test_… key (tenant: sdk-tenant-a, all scopes)
    RECKON_LIVE_KEY   an sk_live_… key (same tenant)

When any of them is absent the suite prints a named SKIP line and
exits 0 (an env gap, never a failure). Run standalone with:

    python3 test_reckon.py
"""

from __future__ import annotations

import json
import os
import re
import sys
import unittest
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import requests  # noqa: F401  (the client's only dependency)
    from reckon import ErrorCodes, ReckonClient, ReckonError
except ImportError as exc:  # env gap, not a failure
    print(f"SKIP [sdks/python test_reckon.py]: python3 environment gap — {exc}")
    sys.exit(0)

BASE_URL = os.environ.get("RECKON_BASE_URL", "")
TEST_KEY = os.environ.get("RECKON_TEST_KEY", "")
LIVE_KEY = os.environ.get("RECKON_LIVE_KEY", "")

if not (BASE_URL and TEST_KEY and LIVE_KEY):
    print(
        "SKIP [sdks/python test_reckon.py]: env gap — RECKON_BASE_URL / "
        "RECKON_TEST_KEY / RECKON_LIVE_KEY are not set (the monorepo "
        "harness packages/sdk/test/python-sdk.test.ts provides them)"
    )
    sys.exit(0)

TENANT = {"tenantId": "sdk-tenant-a"}
SECRET_PATTERN = re.compile(r"^whsec_[A-Za-z0-9]{24,}$")


def decision_kwargs(item_id: str = "item-1", request_id: str | None = None) -> dict:
    """The frozen reckon.decision-request body, snake_case kwargs form
    (exactly the docs quickstart shape, with test-mode item ids)."""
    return {
        "schema": "reckon.decision-request",
        "schema_version": "0.1.0",
        "request_id": request_id or f"req-{uuid.uuid4().hex[:12]}",
        "tenant": TENANT,
        "subject": {"kind": "user", "ref": "usr_88213"},
        "objective": {"objectiveId": "obj_relax_evening", "kind": "relax"},
        "attention_policy": {"policyId": "att_balanced", "style": "balanced"},
        "context": {"contextId": "ctx-1"},
        "candidates": {
            "setId": f"cs-{uuid.uuid4().hex[:8]}",
            "candidates": [{"itemId": item_id, "source": "host-retrieval", "rankHint": 1}],
        },
        "policy_selector": {"policyId": "pol_evening_relax", "version": "3"},
        "idempotency_key": f"idem-{uuid.uuid4().hex[:12]}",
    }


class TestConfigValidation(unittest.TestCase):
    def test_empty_api_key_is_a_config_error(self):
        with self.assertRaises(ReckonError) as caught:
            ReckonClient(api_key="")
        self.assertEqual(caught.exception.code, ErrorCodes.CONFIG_ERROR)

    def test_malformed_api_version_is_rejected_at_construction(self):
        with self.assertRaises(ReckonError) as caught:
            ReckonClient(api_key=TEST_KEY, api_version="not-a-version")
        self.assertEqual(caught.exception.code, ErrorCodes.CONFIG_ERROR)


class TestDecisionsAndOutcomes(unittest.TestCase):
    """The quickstart loop: serve a recommendation, close the loop."""

    def setUp(self):
        self.client = ReckonClient(api_key=TEST_KEY, base_url=BASE_URL)

    def test_decision_request_and_result_shape(self):
        decision = self.client.decisions.request(**decision_kwargs("item-1"))
        self.assertEqual(decision.action, "SUGGEST")
        self.assertTrue(decision.decision_id)
        self.assertEqual(decision.tenant.tenant_id, "sdk-tenant-a")
        self.assertEqual(decision.policy.policy_id, "pol_evening_relax")
        # The mode marker rides every authenticated response.
        self.assertEqual(self.client.last_mode, "test")

    def test_decision_get_by_id(self):
        created = self.client.decisions.request(**decision_kwargs("item-1"))
        fetched = self.client.decisions.get(created.decision_id)
        self.assertEqual(fetched.decision_id, created.decision_id)
        self.assertEqual(fetched.action, "SUGGEST")

    def test_decision_get_with_expand_embeds_the_item_key(self):
        created = self.client.decisions.request(**decision_kwargs("item-1"))
        expanded = self.client.decisions.get(
            created.decision_id, expand=["selectedExperience.item"]
        )
        # Test-mode expansions read no live catalog state: the embedded
        # item is an EXPLICIT null (honest-absence expansion), but the
        # key IS present in the expanded response.
        selected = expanded.to_dict()["selectedExperience"]
        self.assertIn("item", selected)
        self.assertIsNone(selected["item"])
        # Without expand the key is absent entirely.
        plain = self.client.decisions.get(created.decision_id)
        self.assertNotIn("item", plain.to_dict()["selectedExperience"])

    def test_outcome_append_closes_the_loop(self):
        decision = self.client.decisions.request(**decision_kwargs("item-1"))
        event = self.client.outcomes.append(
            schema="reckon.outcome-event",
            schema_version="0.1.0",
            event_id=f"evt-{uuid.uuid4().hex[:12]}",
            tenant=TENANT,
            decision_id=decision.decision_id,
            experience_id=decision.selected_experience.experience_id,
            subject={"kind": "user", "ref": "usr_88213"},
            event_type="completion",
            occurred_at=2000,
            metrics={"watchedSeconds": 1180},
            evidence_class="production-observed",
            idempotency_key=f"idem-{uuid.uuid4().hex[:12]}",
        )
        self.assertEqual(event.event_type, "completion")
        self.assertEqual(event.decision_id, decision.decision_id)
        self.assertEqual(event.evidence_class, "production-observed")


class TestModeSemantics(unittest.TestCase):
    """S2-003 test mode through the Python client."""

    def setUp(self):
        self.test_client = ReckonClient(api_key=TEST_KEY, base_url=BASE_URL)
        self.live_client = ReckonClient(api_key=LIVE_KEY, base_url=BASE_URL)

    def test_magic_item_ids_select_canned_scenarios(self):
        declined = self.test_client.decisions.request(**decision_kwargs("itm_test_decline"))
        self.assertEqual(declined.action, "HOLD")
        self.assertIsNone(declined.to_dict().get("selectedExperience"))
        self.assertEqual(self.test_client.last_mode, "test")

        queued = self.test_client.decisions.request(**decision_kwargs("itm_test_queue"))
        self.assertEqual(queued.action, "QUEUE")
        self.assertEqual(len(queued.schedule_delta.enqueue), 1)

    def test_live_key_is_mode_marked_live(self):
        decision = self.live_client.decisions.request(**decision_kwargs("item-1"))
        self.assertEqual(decision.action, "SUGGEST")
        self.assertEqual(self.live_client.last_mode, "live")

    def test_live_key_with_magic_test_item_is_mode_mismatch(self):
        with self.assertRaises(ReckonError) as caught:
            self.live_client.decisions.request(**decision_kwargs("itm_test_decline"))
        error = caught.exception
        self.assertEqual(error.code, ErrorCodes.MODE_MISMATCH)
        self.assertEqual(error.status_code, 403)
        self.assertEqual(error.error_class, "permission_error")
        self.assertEqual(error.mode, "live")

    def test_cross_mode_decision_read_is_mode_mismatch(self):
        # The live key creates a live decision…
        live_decision = self.live_client.decisions.request(**decision_kwargs("item-1"))
        # …the TEST key cannot read it (cross-mode, never a payload leak).
        with self.assertRaises(ReckonError) as caught:
            self.test_client.decisions.get(live_decision.decision_id)
        self.assertEqual(caught.exception.code, ErrorCodes.MODE_MISMATCH)
        self.assertEqual(caught.exception.status_code, 403)


class TestVersionPinning(unittest.TestCase):
    def test_registered_version_pin_serves(self):
        client = ReckonClient(api_key=TEST_KEY, base_url=BASE_URL, api_version="0.1.0")
        decision = client.decisions.request(**decision_kwargs("item-1"))
        self.assertEqual(decision.action, "SUGGEST")

    def test_unregistered_version_pin_is_a_typed_400(self):
        client = ReckonClient(api_key=TEST_KEY, base_url=BASE_URL, api_version="2099-01-01")
        with self.assertRaises(ReckonError) as caught:
            client.decisions.request(**decision_kwargs("item-1"))
        error = caught.exception
        self.assertEqual(error.code, ErrorCodes.VALIDATION_ERROR)
        self.assertEqual(error.status_code, 400)
        self.assertEqual(error.param, "X-Reckon-Version")


class TestErrorModel(unittest.TestCase):
    def setUp(self):
        self.client = ReckonClient(api_key=TEST_KEY, base_url=BASE_URL)

    def test_unknown_decision_is_a_typed_404(self):
        with self.assertRaises(ReckonError) as caught:
            self.client.decisions.get("dec_unknown_404")
        error = caught.exception
        self.assertEqual(error.code, ErrorCodes.NOT_FOUND)
        self.assertEqual(error.status_code, 404)
        self.assertEqual(error.error_class, "invalid_request_error")
        self.assertTrue(error.doc_url and "/errors/not-found" in error.doc_url)
        self.assertEqual(error.mode, "test")

    def test_unknown_key_is_a_typed_401(self):
        rogue = ReckonClient(api_key="sk_test_unknown_key_unknown_key_0000000000", base_url=BASE_URL)
        with self.assertRaises(ReckonError) as caught:
            rogue.decisions.request(**decision_kwargs("item-1"))
        error = caught.exception
        self.assertEqual(error.code, ErrorCodes.UNAUTHENTICATED)
        self.assertEqual(error.status_code, 401)
        self.assertEqual(error.error_class, "authentication_error")

    def test_transport_failure_never_leaks_raw_requests_errors(self):
        dead = ReckonClient(api_key=TEST_KEY, base_url="http://127.0.0.1:1", timeout=1.0)
        with self.assertRaises(ReckonError) as caught:
            dead.decisions.request(**decision_kwargs("item-1"))
        self.assertEqual(caught.exception.code, ErrorCodes.TRANSPORT_ERROR)
        self.assertIsNone(caught.exception.status_code)


class TestWebhookEndpoints(unittest.TestCase):
    def setUp(self):
        self.client = ReckonClient(api_key=TEST_KEY, base_url=BASE_URL)
        self.suffix = uuid.uuid4().hex[:8]

    def _url(self, label: str) -> str:
        return f"https://hooks.example.com/{self.suffix}-{label}"

    def test_create_returns_one_time_secret_and_view(self):
        endpoint = self.client.webhook_endpoints.create(self._url("create"), description="docs matrix")
        self.assertEqual(endpoint.object, "webhook_endpoint")
        self.assertEqual(endpoint.url, self._url("create"))
        self.assertEqual(endpoint.status, "enabled")
        self.assertEqual(endpoint.description, "docs matrix")
        self.assertEqual(endpoint.tenant.tenant_id, "sdk-tenant-a")
        self.assertRegex(endpoint.secret, SECRET_PATTERN)

        fetched = self.client.webhook_endpoints.get(endpoint.id)
        self.assertEqual(fetched.id, endpoint.id)
        self.assertNotIn("secret", fetched.to_dict())  # issued exactly once

    def test_get_unknown_endpoint_is_404(self):
        with self.assertRaises(ReckonError) as caught:
            self.client.webhook_endpoints.get("we_unknown_404")
        self.assertEqual(caught.exception.code, ErrorCodes.NOT_FOUND)

    def test_delete_returns_view_then_404s(self):
        endpoint = self.client.webhook_endpoints.create(self._url("delete"))
        removed = self.client.webhook_endpoints.delete(endpoint.id)
        self.assertEqual(removed.id, endpoint.id)
        with self.assertRaises(ReckonError) as caught:
            self.client.webhook_endpoints.delete(endpoint.id)
        self.assertEqual(caught.exception.code, ErrorCodes.NOT_FOUND)

    def test_cursor_pagination_and_auto_iterator(self):
        created = [
            self.client.webhook_endpoints.create(self._url(f"p{i}")) for i in range(3)
        ]
        newest_first = list(reversed([e.id for e in created]))

        # The endpoint store is shared across the suite (one real
        # server), but this test's endpoints are the three NEWEST —
        # pagination slices that stable newest-first order.
        page1 = self.client.webhook_endpoints.list(limit=2)
        self.assertEqual([e.id for e in page1.endpoints], newest_first[:2])
        self.assertTrue(page1.has_more)
        self.assertEqual(page1.next_cursor, newest_first[1])

        # Resuming after the cursor: this test's oldest endpoint first,
        # then any older endpoints previous tests created (exhausting
        # the list — has_more False either way).
        page2 = self.client.webhook_endpoints.list(limit=2, starting_after=page1.next_cursor)
        self.assertEqual(page2.endpoints[0].id, newest_first[2])
        self.assertFalse(page2.has_more)

        seen = [e.id for e in self.client.webhook_endpoints.list_all(limit=2)]
        self.assertEqual(seen[:3], newest_first)

    def test_idempotent_create_replays(self):
        body_url = self._url("idem")
        first = self.client.webhook_endpoints.create(body_url, idempotency_key="py-idem-1")
        second = self.client.webhook_endpoints.create(body_url, idempotency_key="py-idem-1")
        self.assertEqual(second.id, first.id)


class TestWebhookEventsAndDeliveries(unittest.TestCase):
    def setUp(self):
        self.client = ReckonClient(api_key=TEST_KEY, base_url=BASE_URL)
        self.suffix = uuid.uuid4().hex[:8]

    def test_lifecycle_event_retrieval_and_replay(self):
        endpoint = self.client.webhook_endpoints.create(
            f"https://hooks.example.com/{self.suffix}-events"
        )

        # The creation fanned out the webhook.endpoint.created event to
        # every matching endpoint — including this one (empty filter =
        # every event type). This endpoint's own delivery is the one to
        # walk: event retrieval → replay → the delivery log.
        page = self.client.webhook_deliveries.list(endpoint_id=endpoint.id)
        self.assertGreaterEqual(len(page.deliveries), 1)
        delivery = page.deliveries[0]
        self.assertEqual(delivery.status, "succeeded")
        self.assertEqual(delivery.response_code, 200)
        self.assertFalse(delivery.replayed)

        event = self.client.webhook_events.get(delivery.event_id)
        self.assertEqual(event.id, delivery.event_id)
        self.assertEqual(event.object, "event")
        self.assertEqual(event.type, "webhook.endpoint.created")
        self.assertEqual(event.data.object.endpoint_id, endpoint.id)

        # Replay re-delivers the SAME event id to every currently-
        # matching endpoint; assert THIS endpoint's replay row.
        replay = self.client.webhook_events.replay(event.id)
        self.assertEqual(replay.event.id, event.id)  # the SAME event id
        mine = [d for d in replay.deliveries if d.endpoint_id == endpoint.id]
        self.assertEqual(len(mine), 1)
        self.assertTrue(mine[0].replayed)
        self.assertEqual(mine[0].event_id, event.id)

        # The delivery log (filtered to this endpoint + event) shows
        # both rows, newest first: the replay, then the original.
        rows = self.client.webhook_deliveries.list(
            endpoint_id=endpoint.id, event_id=event.id
        ).deliveries
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0].replayed, True)
        self.assertEqual(rows[1].replayed, False)

    def test_unknown_event_is_404(self):
        with self.assertRaises(ReckonError) as caught:
            self.client.webhook_events.get("evt_unknown_404")
        self.assertEqual(caught.exception.code, ErrorCodes.NOT_FOUND)
        with self.assertRaises(ReckonError) as caught:
            self.client.webhook_events.replay("evt_unknown_404")
        self.assertEqual(caught.exception.code, ErrorCodes.NOT_FOUND)

    def test_event_payload_is_the_documented_thin_envelope(self):
        endpoint = self.client.webhook_endpoints.create(
            f"https://hooks.example.com/{self.suffix}-envelope"
        )
        delivery = self.client.webhook_deliveries.list(endpoint_id=endpoint.id).deliveries[0]
        event = self.client.webhook_events.get(delivery.event_id)
        payload = event.to_dict()
        for key in ("id", "object", "type", "created", "tenant", "data"):
            self.assertIn(key, payload)
        self.assertEqual(payload["object"], "event")
        # data.object carries ids only — thin by law.
        self.assertTrue(set(payload["data"]["object"]).issubset({"endpointId", "url", "eventTypes"}))


class TestDocsQuickstartFlow(unittest.TestCase):
    """The exact quickstart sequence, end to end, in test mode."""

    def test_serve_read_close_the_loop(self):
        reckon = ReckonClient(api_key=TEST_KEY, base_url=BASE_URL)

        decision = reckon.decisions.request(**decision_kwargs("item-1"))
        self.assertEqual(decision.action, "SUGGEST")

        looked_up = reckon.decisions.get(decision.decision_id)
        self.assertEqual(looked_up.decision_id, decision.decision_id)

        outcome = reckon.outcomes.append(
            schema="reckon.outcome-event",
            schema_version="0.1.0",
            event_id=f"evt-{uuid.uuid4().hex[:12]}",
            tenant=TENANT,
            decision_id=decision.decision_id,
            experience_id=decision.selected_experience.experience_id,
            subject={"kind": "user", "ref": "usr_88213"},
            event_type="completion",
            occurred_at=2000,
            metrics={"watchedSeconds": 1180},
            evidence_class="production-observed",
            idempotency_key=f"idem-{uuid.uuid4().hex[:12]}",
        )
        self.assertEqual(outcome.event_type, "completion")
        self.assertEqual(reckon.last_mode, "test")


if __name__ == "__main__":
    print(f"reckon python docs-matrix: base_url={BASE_URL}")
    unittest.main(verbosity=2)
