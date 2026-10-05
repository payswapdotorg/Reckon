"""Manage webhook endpoints, walk the delivery log, replay events.

The S2-002 webhook management surface through the Python client:
register an endpoint (the ONE-TIME signing secret is issued at
creation), inspect the delivery log (cursor pages + filters), fetch a
stored event, and replay it (same event id, at-least-once).

    python3 examples/manage_webhooks.py
"""

from __future__ import annotations

import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from reckon import ReckonClient


def main() -> None:
    reckon = ReckonClient(
        api_key=os.environ.get("RECKON_API_KEY", ""),
        base_url=os.environ.get("RECKON_BASE_URL", "https://api.reckon.dev"),
    )

    # 1. Register an endpoint. Store endpoint.secret IMMEDIATELY — it
    #    is never returned again.
    endpoint = reckon.webhook_endpoints.create(
        "https://hooks.example.com/reckon",
        description="nightly reconciliation",
    )
    print(f"endpoint : {endpoint.id} → {endpoint.url}")
    print(f"secret   : {endpoint.secret[:11]}… (whsec_ issued once — store it now)")

    # 2. The creation itself fanned out webhook.endpoint.created — the
    #    delivery log already has evidence (newest first, cursor pages).
    page = reckon.webhook_deliveries.list(endpoint_id=endpoint.id, limit=10)
    print(f"deliveries: {len(page.deliveries)} (has_more={page.has_more})")
    for delivery in page.deliveries:
        print(
            f"  {delivery.id}: {delivery.status} http={delivery.response_code}"
            f" attempts={delivery.attempts} replayed={delivery.replayed}"
        )

    # 3. Fetch the stored event behind a delivery (30-day retention).
    if page.deliveries:
        event = reckon.webhook_events.get(page.deliveries[0].event_id)
        print(f"event    : {event.id} type={event.type} object={event.object}")

        # 4. Replay it — the SAME event id is re-delivered to every
        #    currently-matching endpoint; dedupe on event.id.
        replay = reckon.webhook_events.replay(event.id)
        print(f"replay   : {replay.event.id} → {len(replay.deliveries)} new deliveries")

    # 5. Housekeeping: list every endpoint (auto-paginating), then
    #    delete the one we created.
    for existing in reckon.webhook_endpoints.list_all(limit=20):
        print(f"  known endpoint: {existing.id} {existing.url}")
    removed = reckon.webhook_endpoints.delete(endpoint.id)
    print(f"deleted  : {removed.id}")


if __name__ == "__main__":
    main()
