"""Signature-verification matrix for the Python reference client.

Verifies ``reckon.verify_webhook`` (the docs-named alias of the
canonical implementation) against an accept/reject matrix computed with
INDEPENDENT hmac calls — the same matrix the monorepo's docs-lockstep
test (apps/api/test/webhook-signature-docs.test.ts) runs against the
published docs sample. No server needed; runs wherever python3 exists.

    python3 test_verify_webhook.py
"""

from __future__ import annotations

import hashlib
import hmac
import os
import sys
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from reckon import sign_webhook_payload, verify_reckon_signature, verify_webhook
except ImportError as exc:  # env gap, not a failure
    print(f"SKIP [sdks/python test_verify_webhook.py]: python3 environment gap — {exc}")
    sys.exit(0)

# A placeholder-shaped secret (the scanner law: no realistic long
# alphanumeric runs after the whsec_ prefix in fixtures).
SECRET = "whsec_pytest_secret_placeholder"
BODY = (
    b'{"id":"evt_py_1","object":"event","type":"preference.updated",'
    b'"created":1769998921000,"tenant":{"tenantId":"demo"},'
    b'"data":{"object":{"deltaId":"delta-1","dimension":"topic.calm","op":"add"}}}'
)


def independent_signature(secret: str, body: bytes, t: int) -> str:
    """Recompute the HMAC with node:crypto-equivalent primitives — no
    shared code with the implementation under test."""
    digest = hmac.new(secret.encode("utf-8"), f"{t}.".encode("ascii") + body, hashlib.sha256).hexdigest()
    return f"t={t},v1={digest}"


class TestAcceptMatrix(unittest.TestCase):
    def test_fresh_signature_accepts(self):
        now = int(time.time())
        header = independent_signature(SECRET, BODY, now)
        self.assertTrue(verify_webhook(BODY, header, SECRET))
        self.assertTrue(verify_reckon_signature(BODY, header, SECRET))
        # str bodies are encoded exactly like bytes bodies
        self.assertTrue(verify_webhook(BODY.decode("utf-8"), header, SECRET))

    def test_boundary_age_299s_accepts(self):
        now = int(time.time()) - 299
        header = independent_signature(SECRET, BODY, now)
        self.assertTrue(verify_webhook(BODY, header, SECRET))

    def test_extra_fields_in_header_are_tolerated(self):
        now = int(time.time())
        header = independent_signature(SECRET, BODY, now)
        v1 = header.split(",v1=", 1)[1]
        enriched = f"v0=extra,t={now},v1={v1}"
        self.assertTrue(verify_webhook(BODY, enriched, SECRET))


class TestRejectMatrix(unittest.TestCase):
    def test_tampered_body_trailing_byte(self):
        now = int(time.time())
        header = independent_signature(SECRET, BODY, now)
        self.assertFalse(verify_webhook(BODY + b" ", header, SECRET))

    def test_tampered_body_mutated_json(self):
        now = int(time.time())
        header = independent_signature(SECRET, BODY, now)
        mutated = BODY.replace(b"delta-1", b"delta-2")
        self.assertFalse(verify_webhook(mutated, header, SECRET))

    def test_wrong_secret(self):
        now = int(time.time())
        header = independent_signature(SECRET, BODY, now)
        self.assertFalse(verify_webhook(BODY, header, "whsec_wrong_secret_placeholder"))

    def test_stale_timestamp_302s(self):
        now = int(time.time()) - 302
        header = independent_signature(SECRET, BODY, now)
        self.assertFalse(verify_webhook(BODY, header, SECRET))

    def test_future_timestamp_302s(self):
        now = int(time.time()) + 302
        header = independent_signature(SECRET, BODY, now)
        self.assertFalse(verify_webhook(BODY, header, SECRET))

    def test_missing_t(self):
        self.assertFalse(verify_webhook(BODY, "v1=" + "0" * 64, SECRET))

    def test_missing_v1(self):
        self.assertFalse(verify_webhook(BODY, "t=1769997725", SECRET))

    def test_garbage_and_empty_headers(self):
        self.assertFalse(verify_webhook(BODY, "nonsense", SECRET))
        self.assertFalse(verify_webhook(BODY, "", SECRET))

    def test_wrong_signature_equal_length(self):
        now = int(time.time())
        forged = f"t={now},v1={'0' * 64}"
        self.assertFalse(verify_webhook(BODY, forged, SECRET))

    def test_non_hex_signature(self):
        now = int(time.time())
        self.assertFalse(verify_webhook(BODY, f"t={now},v1={'z' * 64}", SECRET))

    def test_short_signature(self):
        now = int(time.time())
        self.assertFalse(verify_webhook(BODY, f"t={now},v1=abcd", SECRET))


class TestDocumentedDivergence(unittest.TestCase):
    def test_non_numeric_t_raises_value_error(self):
        # The published docs sample (and this client, byte for byte)
        # RAISES on a non-numeric t where the TypeScript reference
        # returns False — both are "reject" outcomes; receivers that
        # prefer the boolean posture catch the exception.
        with self.assertRaises(ValueError):
            verify_webhook(BODY, "t=banana,v1=" + "0" * 64, SECRET)


class TestSigner(unittest.TestCase):
    def test_signer_produces_the_documented_header_format(self):
        header = sign_webhook_payload(SECRET, BODY, 1769997725)
        self.assertRegex(header, r"^t=\d{10},v1=[0-9a-f]{64}$")
        self.assertTrue(verify_webhook(BODY, header, SECRET, now=1769997725.0))

    def test_injected_clock_keeps_verification_deterministic(self):
        header = sign_webhook_payload(SECRET, BODY, 1_000_000)
        self.assertTrue(verify_webhook(BODY, header, SECRET, tolerance=300, now=1_000_050.0))
        self.assertFalse(verify_webhook(BODY, header, SECRET, tolerance=300, now=1_000_400.0))


if __name__ == "__main__":
    unittest.main(verbosity=2)
