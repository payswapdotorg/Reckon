"""A webhook receiver that verifies every delivery — stdlib only.

The receiver pattern the docs prescribe: read the RAW body (before any
JSON parsing — re-serialized JSON does not match the signature), verify
the Reckon-Signature header in constant time, enforce the 5-minute
tolerance, and return 2xx FAST (do the work async; a slow handler
looks like a failure and triggers retries).

    RECKON_WEBHOOK_SECRET=whsec_… python3 examples/verify_webhook_handler.py
    # then, in another shell:
    curl -X POST localhost:9090/webhooks \
      -H 'Content-Type: application/json' \
      -H 'Reckon-Signature: t=1769997725,v1=<hex>' \
      -d '{"id":"evt_…","object":"event","type":"preference.updated"}'
"""

from __future__ import annotations

import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from reckon import verify_webhook

SECRET = os.environ.get("RECKON_WEBHOOK_SECRET", "")
SEEN_EVENT_IDS: set[str] = set()
WORK_QUEUE: list[dict] = []
LOCK = threading.Lock()


class WebhookHandler(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802 (stdlib naming)
        if self.path != "/webhooks":
            self.send_error(404)
            return
        # 1. The RAW body — exactly the bytes that were signed.
        length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(length)

        # 2. Verify: constant-time HMAC over "{t}.{raw_body}", 5-minute
        #    tolerance on t (the replay guard).
        signature = self.headers.get("Reckon-Signature", "")
        if not SECRET or not verify_webhook(raw_body, signature, SECRET):
            # Reject and let Reckon's retry schedule do its job — never
            # process an unverifiable delivery.
            self.send_error(401)
            return

        event = json.loads(raw_body)
        event_id = event.get("id", "")

        # 3. Dedupe on event.id — delivery is at-least-once, replays
        #    reuse the SAME id.
        with LOCK:
            if event_id in SEEN_EVENT_IDS:
                self._ok()
                return
            SEEN_EVENT_IDS.add(event_id)
            # 4. Return 2xx quickly; the real work happens off-thread.
            WORK_QUEUE.append(event)
        self._ok()

    def _ok(self) -> None:
        self.send_response(202)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        print(f"[webhook] {format % args}")


def worker() -> None:
    """The async side: drain the queue exactly like a real app would."""
    while True:
        with LOCK:
            queue = WORK_QUEUE[:]
            WORK_QUEUE.clear()
        for event in queue:
            print(f"[worker] processing {event.get('type')} ({event.get('id')})")
            # …your side effects here: analytics, bookkeeping, sync….


if __name__ == "__main__":
    if not SECRET:
        print("set RECKON_WEBHOOK_SECRET=whsec_… first (the endpoint's signing secret)")
        sys.exit(1)
    threading.Thread(target=worker, daemon=True).start()
    server = HTTPServer(("127.0.0.1", 9090), WebhookHandler)
    print("listening on http://127.0.0.1:9090/webhooks")
    server.serve_forever()
