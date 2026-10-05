"""Serve your first recommendation — the docs quickstart, in Python.

Mirrors apps/docs quickstart "Serve your first recommendation" +
"Close the loop": request a decision with a TEST-mode key, read the
result, and report the outcome. Run it against any Reckon deployment
(in test mode) with:

    RECKON_BASE_URL=http://localhost:3000 \
    RECKON_API_KEY=sk_test_… \
    python3 examples/serve_recommendation.py
"""

from __future__ import annotations

import os
import sys
import time
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from reckon import ReckonClient

TENANT = {"tenantId": "demo"}


def main() -> None:
    reckon = ReckonClient(
        api_key=os.environ.get("RECKON_API_KEY", ""),
        base_url=os.environ.get("RECKON_BASE_URL", "https://api.reckon.dev"),
        api_version="0.1.0",  # pin the version you build against
    )

    # 1. Serve your first recommendation. In TEST mode, a magic
    #    itm_test_<scenario> item id selects a canned scenario exactly
    #    like Stripe's magic test card numbers (itm_test_decline →
    #    HOLD, itm_test_suggest → SUGGEST, …).
    decision = reckon.decisions.request(
        schema="reckon.decision-request",
        schema_version="0.1.0",
        request_id=f"req-{uuid.uuid4().hex[:12]}",
        tenant=TENANT,
        subject={"kind": "user", "ref": "usr_88213"},
        objective={"objectiveId": "obj_relax_evening", "kind": "relax"},
        attention_policy={"policyId": "att_balanced", "style": "balanced"},
        context={"contextId": "ctx_01J8ZWJ9K2"},
        candidates={
            "setId": f"cand-{uuid.uuid4().hex[:8]}",
            "candidates": [
                {
                    "itemId": "itm_test_suggest",  # the magic test item
                    "realizationIds": ["rlz_reef_en_hd"],
                    "source": "host-retrieval",
                    "rankHint": 1,
                }
            ],
        },
        policy_selector={"policyId": "pol_evening_relax", "version": "3"},
        idempotency_key=f"idem-{uuid.uuid4().hex[:12]}",
    )

    print(f"action           : {decision.action}")  # "SUGGEST"
    print(f"decisionId       : {decision.decision_id}")
    print(f"selected item    : {decision.selected_experience.item_id}")
    print(f"confidence       : {decision.uncertainty.confidence if decision.uncertainty else 'n/a'}")
    print(f"mode (X-Reckon-Mode): {reckon.last_mode}")  # "test"

    # 2. Read the decision — same frozen payload by id.
    fetched = reckon.decisions.get(decision.decision_id)
    assert fetched.decision_id == decision.decision_id

    # 3. Close the loop: report what actually happened.
    outcome = reckon.outcomes.append(
        schema="reckon.outcome-event",
        schema_version="0.1.0",
        event_id=f"evt-{uuid.uuid4().hex[:12]}",
        tenant=TENANT,
        decision_id=decision.decision_id,
        experience_id=decision.selected_experience.experience_id,
        subject={"kind": "user", "ref": "usr_88213"},
        event_type="completion",
        occurred_at=int(time.time() * 1000),
        metrics={"watchedSeconds": 1180},
        evidence_class="production-observed",
        idempotency_key=f"idem-{uuid.uuid4().hex[:12]}",
    )
    print(f"outcome recorded  : {outcome.event_id} ({outcome.event_type})")


if __name__ == "__main__":
    main()
