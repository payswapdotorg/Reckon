"""reckon — the Python reference client for the Reckon API.

A thin, typed-by-convention client over HTTP + the frozen Reckon
contracts. The same laws the TypeScript SDK (@reckon/sdk) follows, in
Python form:

- NO LLM anywhere: pure plumbing over HTTP; nothing here requires or
  invokes a model.
- Pythonic surface, frozen wire: methods take snake_case keyword
  arguments (``request_id=…``) that serialize onto the frozen
  camelCase contracts (``requestId``), and responses come back as
  :class:`ReckonObject` values with snake_case attribute access
  (``decision.decision_id``). Nested structures pass through as the
  wire spells them.
- Typed errors, never raw failures: every failure raises
  :class:`ReckonError` carrying the stable machine ``code`` — raw
  ``requests`` exceptions never escape the client.
- ONE canonical webhook algorithm: :func:`verify_webhook` is the
  reference implementation published on the docs portal (HMAC-SHA256
  over ``"{t}.{raw_body}"``, constant-time comparison, 5-minute
  tolerance) — byte for byte.

The only dependency is ``requests``.

Usage::

    import os
    from reckon import ReckonClient

    reckon = ReckonClient(
        api_key=os.environ["RECKON_API_KEY"],  # sk_test_… or sk_live_…
        base_url="https://api.reckon.dev",
        api_version="0.1.0",  # optional X-Reckon-Version pin
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
            "candidates": [{"itemId": "item-1", "source": "host-retrieval"}],
        },
        policy_selector={"policyId": "pol_evening_relax", "version": "3"},
        idempotency_key="idem-1",
    )
    print(decision.action, decision.decision_id)
"""

from __future__ import annotations

import hashlib
import hmac
import re
import time
import uuid
from typing import Any, Dict, Iterator, List, Optional, Tuple, Union

import requests

__all__ = [
    "ReckonClient",
    "ReckonError",
    "ReckonObject",
    "ErrorCodes",
    "verify_webhook",
    "verify_reckon_signature",
    "sign_webhook_payload",
    "SIGNATURE_HEADER",
    "SIGNATURE_TOLERANCE_SECONDS",
    "DEFAULT_BASE_URL",
    "DEFAULT_TIMEOUT_SECONDS",
]

DEFAULT_BASE_URL = "https://api.reckon.dev"
DEFAULT_TIMEOUT_SECONDS = 30.0

# ---------------------------------------------------------------------------
# Error model — the stable machine-code vocabulary (frozen ERROR_CATALOG
# in @reckon/contracts) plus the one client-side transport code. Every
# failure raises ReckonError; raw requests exceptions never escape.
# ---------------------------------------------------------------------------


class ErrorCodes:
    """Stable machine codes — branch on these, never on messages."""

    # Server-originated (the frozen catalog).
    VALIDATION_ERROR = "VALIDATION_ERROR"
    UNAUTHENTICATED = "UNAUTHENTICATED"
    TENANT_MISMATCH = "TENANT_MISMATCH"
    MODE_MISMATCH = "MODE_MISMATCH"
    INSUFFICIENT_SCOPE = "INSUFFICIENT_SCOPE"
    NOT_FOUND = "NOT_FOUND"
    IDEMPOTENCY_CONFLICT = "IDEMPOTENCY_CONFLICT"
    RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED"
    NOT_WIRED = "NOT_WIRED"
    HANDLER_RESPONSE_INVALID = "HANDLER_RESPONSE_INVALID"
    HANDLER_TENANT_VIOLATION = "HANDLER_TENANT_VIOLATION"
    INTERNAL = "INTERNAL"
    # Client-side: the request never reached the server.
    TRANSPORT_ERROR = "SDK_TRANSPORT_ERROR"
    RESPONSE_NOT_JSON = "SDK_RESPONSE_NOT_JSON"
    CONFIG_ERROR = "SDK_CONFIG_ERROR"


class ReckonError(Exception):
    """Every failure the client can produce.

    Attributes:
        code: the stable machine code (see :class:`ErrorCodes`).
        status_code: HTTP status when the server responded (``None``
            client-side).
        error_class: the stable wire class (``invalid_request_error``,
            ``authentication_error``, ``permission_error``,
            ``rate_limit_error``, ``api_error``) when present.
        param: the offending request parameter the server named.
        doc_url: the docs page for this error code.
        details: the envelope's ``details`` payload, when present.
        mode: ``live`` | ``test`` — the mode of the key that served the
            failing response (the API marks every authenticated
            response, successes and errors, with ``X-Reckon-Mode``).
        retry_after: ``Retry-After`` seconds on 429 rate-limit errors.
    """

    def __init__(
        self,
        code: Optional[str],
        message: str,
        status_code: Optional[int] = None,
        error_class: Optional[str] = None,
        param: Optional[str] = None,
        doc_url: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
        mode: Optional[str] = None,
        retry_after: Optional[int] = None,
    ) -> None:
        super().__init__(message)
        #: The human-readable message (mirrors ``str(error)``).
        self.message = message
        self.code = code
        self.status_code = status_code
        self.error_class = error_class
        self.param = param
        self.doc_url = doc_url
        self.details = details
        self.mode = mode
        self.retry_after = retry_after


# ---------------------------------------------------------------------------
# Response objects — snake_case attribute access over the frozen payloads.
# ---------------------------------------------------------------------------

_SNAKE_FIRST = re.compile(r"[A-Z]")


def _to_snake(name: str) -> str:
    """camelCase → snake_case (``schemaVersion`` → ``schema_version``)."""

    return _SNAKE_FIRST.sub(lambda m: "_" + m.group(0).lower(), name).lower()


def _to_camel(name: str) -> str:
    """snake_case → camelCase (``request_id`` → ``requestId``)."""

    head, *rest = name.split("_")
    return head + "".join(part[:1].upper() + part[1:] for part in rest if part != "")


def _wrap(value: Any) -> Any:
    if isinstance(value, dict):
        return ReckonObject(value)
    if isinstance(value, list):
        return [_wrap(item) for item in value]
    return value


class ReckonObject:
    """A response payload with attribute access.

    Keys map in both spellings: ``payload.has_more`` and
    ``payload["has_more"]`` both work, and camelCase keys are reachable
    as snake_case attributes (``decision.decision_id``). Dict literals
    nested inside payloads keep their wire spelling but also wrap
    recursively.
    """

    __slots__ = ("_data",)

    def __init__(self, data: Dict[str, Any]) -> None:
        object.__setattr__(self, "_data", data)

    # -- attribute access (snake_case view over camelCase keys) --------

    def __getattr__(self, name: str) -> Any:
        # Only called when normal lookup fails; _data is a slot.
        data = object.__getattribute__(self, "_data")
        if name in data:  # exact wire spelling (has_more, doc_url, …)
            return _wrap(data[name])
        camel = _to_camel(name)  # decision_id → decisionId
        if camel in data:
            return _wrap(data[camel])
        raise AttributeError(f"{type(self).__name__} has no field {name!r} (fields: {sorted(data)})")

    def __setattr__(self, name: str, value: Any) -> None:
        raise TypeError("ReckonObject is immutable; responses are never mutated in place")

    # -- mapping access (wire spelling preserved) -----------------------

    def __getitem__(self, key: str) -> Any:
        return _wrap(self._data[key])

    def __contains__(self, key: str) -> bool:
        return key in self._data

    def get(self, key: str, default: Any = None) -> Any:
        if key in self._data:
            return _wrap(self._data[key])
        return default

    def to_dict(self) -> Dict[str, Any]:
        """The raw wire payload (frozen camelCase spelling)."""
        return dict(self._data)

    def keys(self):
        return self._data.keys()

    def items(self):
        return self._data.items()

    def __eq__(self, other: object) -> bool:
        if isinstance(other, ReckonObject):
            return self._data == other._data
        if isinstance(other, dict):
            return self._data == other
        return NotImplemented

    def __repr__(self) -> str:
        return f"ReckonObject({self._data!r})"


# ---------------------------------------------------------------------------
# Webhook signatures — the ONE canonical algorithm, byte for byte the
# docs reference sample (apps/docs webhooks page): HMAC-SHA256 over
# "{t}.{raw_body}", constant-time comparison, 5-minute tolerance.
# ---------------------------------------------------------------------------

#: The header carrying the delivery signature.
SIGNATURE_HEADER = "Reckon-Signature"
#: Timestamp tolerance on ``t=`` (seconds) — the replay-window guard.
SIGNATURE_TOLERANCE_SECONDS = 300


def sign_webhook_payload(secret: str, raw_body: Union[str, bytes], timestamp_seconds: int) -> str:
    """Produce a ``t=<unix>,v1=<hex>`` signature header for ``raw_body``.

    Mirrors the signer the Reckon delivery engine uses; handy for
    receiver-side tests.
    """
    body = raw_body.encode("utf-8") if isinstance(raw_body, str) else raw_body
    t = str(int(timestamp_seconds))
    v1 = hmac.new(secret.encode("utf-8"), f"{t}.".encode("ascii") + body, hashlib.sha256).hexdigest()
    return f"t={t},v1={v1}"


def verify_reckon_signature(
    raw_body: Union[str, bytes],
    header: str,
    secret: str,
    tolerance: int = SIGNATURE_TOLERANCE_SECONDS,
    now: Optional[float] = None,
) -> bool:
    """Verify a Reckon webhook signature (the reference implementation).

    This is the exact algorithm published on the docs portal
    (``verify_reckon_signature`` / ``verify_webhook``) — use the raw
    request body, before any JSON parsing or re-serialization. Like the
    published sample, a non-numeric ``t`` raises ``ValueError`` (the
    TypeScript reference returns ``False`` there; both are "reject"
    outcomes — catch the exception if you prefer the boolean posture).
    """
    body = raw_body.encode("utf-8") if isinstance(raw_body, str) else raw_body
    parts = dict(piece.split("=", 1) for piece in header.split(",") if "=" in piece)
    t, v1 = parts.get("t"), parts.get("v1")
    if not t or not v1:
        return False
    current = time.time() if now is None else now
    if abs(current - int(t)) > tolerance:
        return False
    expected = hmac.new(
        secret.encode("utf-8"), f"{t}.".encode("ascii") + body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, v1)


#: The docs-named alias (the webhooks page: "verify_webhook in Python").
verify_webhook = verify_reckon_signature


# ---------------------------------------------------------------------------
# The client
# ---------------------------------------------------------------------------


class _Resource:
    """Shared plumbing for the resource groups."""

    def __init__(self, client: "ReckonClient") -> None:
        self._client = client


class Decisions(_Resource):
    """POST /v1/decisions · GET /v1/decisions/{id}."""

    def request(self, **kwargs: Any) -> ReckonObject:
        """Request the next best action/experience (frozen
        ``reckon.decision-request`` body — snake_case kwargs map onto
        the camelCase contract; nested structures are dicts as the
        contract spells them). The body's ``idempotency_key`` drives
        store-and-replay semantics (no header is sent — the API
        requires header and body keys to agree when both exist)."""
        return self._client._post_body_keyed("/v1/decisions", _camel_kwargs(kwargs))

    def get(self, decision_id: str, expand: Optional[List[str]] = None) -> ReckonObject:
        """Fetch a decision by id. ``expand`` carries ``?expand[]``
        paths (today: ``selectedExperience.item``)."""
        return self._client._get(f"/v1/decisions/{decision_id}", params=_expand_params(expand))


class Outcomes(_Resource):
    """POST /v1/outcomes — close the loop."""

    def append(self, **kwargs: Any) -> ReckonObject:
        """Append a host-observed outcome event (frozen
        ``reckon.outcome-event`` body; reference the decision — its
        ``idempotency_key`` drives store-and-replay)."""
        return self._client._post_body_keyed("/v1/outcomes", _camel_kwargs(kwargs))


class WebhookEndpoints(_Resource):
    """The /v1/webhooks/endpoints family (scope: webhooks)."""

    def create(
        self,
        url: str,
        event_types: Optional[List[str]] = None,
        description: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> ReckonObject:
        """Register an endpoint. The response carries the ONE-TIME
        ``whsec_…`` signing secret (``endpoint.secret``) — it is never
        returned again; store it immediately. ``event_types=[]`` (the
        default) delivers every event type."""
        body: Dict[str, Any] = {"url": url}
        if event_types is not None:
            body["eventTypes"] = event_types
        if description is not None:
            body["description"] = description
        return self._client._post_header_keyed(
            "/v1/webhooks/endpoints", body, idempotency_key=idempotency_key
        )

    def list(
        self,
        limit: Optional[int] = None,
        starting_after: Optional[str] = None,
    ) -> ReckonObject:
        """One cursor page of endpoints (``endpoints``, ``has_more``,
        ``next_cursor``)."""
        return self._client._get(
            "/v1/webhooks/endpoints", params=_page_params(limit, starting_after)
        )

    def list_all(
        self,
        limit: Optional[int] = None,
    ) -> Iterator[ReckonObject]:
        """Auto-paginating generator over every endpoint (follows
        ``next_cursor``)."""
        starting_after: Optional[str] = None
        while True:
            page = self.list(limit=limit, starting_after=starting_after)
            for endpoint in page.endpoints:
                yield endpoint
            if not page.has_more or page.next_cursor is None:
                return
            starting_after = page.next_cursor

    def get(self, endpoint_id: str) -> ReckonObject:
        """Fetch one endpoint (never carries the secret)."""
        return self._client._get(f"/v1/webhooks/endpoints/{endpoint_id}")

    def delete(self, endpoint_id: str) -> ReckonObject:
        """Delete an endpoint; returns the deleted view."""
        return self._client._delete(f"/v1/webhooks/endpoints/{endpoint_id}")


class WebhookEvents(_Resource):
    """GET /v1/webhooks/events/{id} · POST …/replay."""

    def get(self, event_id: str) -> ReckonObject:
        """Retrieve a stored thin event (30-day retention)."""
        return self._client._get(f"/v1/webhooks/events/{event_id}")

    def replay(self, event_id: str, idempotency_key: Optional[str] = None) -> ReckonObject:
        """Re-deliver the SAME event id to every currently-matching
        endpoint (at-least-once — dedupe on ``event.id``); returns the
        event plus the replay deliveries it created."""
        return self._client._post_header_keyed(
            f"/v1/webhooks/events/{event_id}/replay",
            {},
            idempotency_key=idempotency_key,
        )


class WebhookDeliveries(_Resource):
    """GET /v1/webhooks/deliveries — the queryable delivery log."""

    def list(
        self,
        limit: Optional[int] = None,
        starting_after: Optional[str] = None,
        endpoint_id: Optional[str] = None,
        event_id: Optional[str] = None,
    ) -> ReckonObject:
        """One cursor page of delivery records (filterable by
        ``endpoint_id`` / ``event_id``)."""
        params = _page_params(limit, starting_after)
        if endpoint_id is not None:
            params["endpoint_id"] = endpoint_id
        if event_id is not None:
            params["event_id"] = event_id
        return self._client._get("/v1/webhooks/deliveries", params=params)

    def list_all(
        self,
        limit: Optional[int] = None,
        endpoint_id: Optional[str] = None,
        event_id: Optional[str] = None,
    ) -> Iterator[ReckonObject]:
        """Auto-paginating generator over every delivery record."""
        starting_after: Optional[str] = None
        while True:
            page = self.list(
                limit=limit,
                starting_after=starting_after,
                endpoint_id=endpoint_id,
                event_id=event_id,
            )
            for delivery in page.deliveries:
                yield delivery
            if not page.has_more or page.next_cursor is None:
                return
            starting_after = page.next_cursor


class ReckonClient:
    """The Reckon API client.

    Args:
        api_key: a secret key (``sk_test_…`` / ``sk_live_…``). The mode
            — test or live — is carried IN the key; every response is
            mode-marked (see :attr:`last_mode`).
        base_url: API origin (default ``https://api.reckon.dev``).
        api_version: optional ``X-Reckon-Version`` pin (a registered,
            non-retired version of the deployment; the pinned default
            is used when omitted).
        timeout: per-request timeout in seconds.
        session: an optional preconfigured ``requests.Session``.
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        api_version: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        session: Optional[requests.Session] = None,
    ) -> None:
        if not api_key:
            raise ReckonError(ErrorCodes.CONFIG_ERROR, "api_key must be a non-empty string")
        if api_version is not None and not re.fullmatch(r"(\d{4}-\d{2}-\d{2}|\d+\.\d+\.\d+)", api_version):
            raise ReckonError(
                ErrorCodes.CONFIG_ERROR,
                "api_version must be a semver (X.Y.Z) or calendar date (YYYY-MM-DD) string",
            )
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._api_version = api_version
        self._timeout = timeout
        self._session = session if session is not None else requests.Session()
        #: Mode (``live`` | ``test``) of the key that served the most
        #: recent response, from the ``X-Reckon-Mode`` header the API
        #: sets on every authenticated response. ``None`` before the
        #: first response.
        self.last_mode: Optional[str] = None

        #: Resource groups.
        self.decisions = Decisions(self)
        self.outcomes = Outcomes(self)
        self.webhook_endpoints = WebhookEndpoints(self)
        self.webhook_events = WebhookEvents(self)
        self.webhook_deliveries = WebhookDeliveries(self)

    # -- transport ---------------------------------------------------------

    def _url(self, path: str) -> str:
        return f"{self._base_url}{path}"

    def _headers(self, has_body: bool, idempotency_key: Optional[str]) -> Dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Accept": "application/json",
        }
        if has_body:
            headers["Content-Type"] = "application/json"
        if self._api_version is not None:
            headers["X-Reckon-Version"] = self._api_version
        if idempotency_key is not None:
            headers["Idempotency-Key"] = idempotency_key
        return headers

    def _request(
        self,
        method: str,
        path: str,
        params: Optional[Union[Dict[str, Any], List[Tuple[str, str]]]] = None,
        json_body: Optional[Any] = None,
        idempotency_key: Optional[str] = None,
    ) -> ReckonObject:
        headers = self._headers(json_body is not None, idempotency_key)
        try:
            response = self._session.request(
                method,
                self._url(path),
                params=params,
                json=json_body,
                headers=headers,
                timeout=self._timeout,
            )
        except requests.RequestException as exc:
            raise ReckonError(
                ErrorCodes.TRANSPORT_ERROR,
                f"request to {path} failed at the transport layer: {exc}",
            ) from exc

        self._note_mode(response)
        if not 200 <= response.status_code < 300:
            raise _error_from_response(response)
        try:
            payload = response.json()
        except ValueError as exc:
            raise ReckonError(
                ErrorCodes.RESPONSE_NOT_JSON,
                f"response from {path} is not JSON (status {response.status_code})",
                status_code=response.status_code,
            ) from exc
        if not isinstance(payload, dict):
            raise ReckonError(
                ErrorCodes.RESPONSE_NOT_JSON,
                f"response from {path} is not a JSON object (status {response.status_code})",
                status_code=response.status_code,
            )
        return ReckonObject(payload)

    def _note_mode(self, response: requests.Response) -> None:
        mode = response.headers.get("X-Reckon-Mode")
        if mode in ("live", "test"):
            self.last_mode = mode

    def _get(
        self, path: str, params: Optional[Union[Dict[str, Any], List[Tuple[str, str]]]] = None
    ) -> ReckonObject:
        return self._request("GET", path, params=params)

    def _delete(self, path: str) -> ReckonObject:
        return self._request("DELETE", path)

    def _post_body_keyed(self, path: str, body: Any) -> ReckonObject:
        """POST whose frozen contract carries the idempotency key IN
        the body (decisions, outcomes) — no header (the API requires
        header and body keys to agree when both are present)."""
        return self._request("POST", path, json_body=body)

    def _post_header_keyed(
        self,
        path: str,
        body: Optional[Any] = None,
        idempotency_key: Optional[str] = None,
    ) -> ReckonObject:
        """POST whose contract has no body-level key (webhook endpoint
        create, event replay) — the Idempotency-Key header drives
        store-and-replay, auto-generated per call unless given."""
        key = idempotency_key if idempotency_key is not None else str(uuid.uuid4())
        return self._request("POST", path, json_body=body if body is not None else {}, idempotency_key=key)


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _camel_kwargs(kwargs: Dict[str, Any]) -> Dict[str, Any]:
    """snake_case kwargs → the frozen camelCase wire body (top level).

    Nested structures are passed through exactly as the caller spelled
    them — the frozen contracts are camelCase on the wire, so nested
    dict literals use camelCase keys (``tenant={"tenantId": …}``).
    """
    return {_to_camel(name): value for name, value in kwargs.items()}


def _expand_params(expand: Optional[List[str]]) -> Optional[List[Tuple[str, str]]]:
    """?expand[]=path — repeated query keys, so a list of tuples."""
    if not expand:
        return None
    return [("expand[]", path) for path in expand]


def _page_params(limit: Optional[int], starting_after: Optional[str]) -> Dict[str, Any]:
    params: Dict[str, Any] = {}
    if limit is not None:
        params["limit"] = limit
    if starting_after is not None:
        params["starting_after"] = starting_after
    return params


def _error_from_response(response: requests.Response) -> ReckonError:
    """Map a non-2xx response onto the typed ReckonError (envelope-first)."""
    status = response.status_code
    mode = response.headers.get("X-Reckon-Mode")
    retry_after_raw = response.headers.get("Retry-After")
    retry_after = int(retry_after_raw) if retry_after_raw is not None and retry_after_raw.isdigit() else None
    try:
        payload = response.json()
        error = payload.get("error", {}) if isinstance(payload, dict) else {}
    except ValueError:
        error = {}
    if not isinstance(error, dict) or not error.get("code"):
        return ReckonError(
            None,
            f"error response carries no typed error envelope (status {status})",
            status_code=status,
            mode=mode,
            retry_after=retry_after,
        )
    return ReckonError(
        code=str(error.get("code")),
        message=str(error.get("message") or f"request failed with status {status}"),
        status_code=status,
        error_class=error.get("class"),
        param=error.get("param"),
        doc_url=error.get("doc_url"),
        details=error.get("details") if isinstance(error.get("details"), dict) else None,
        mode=mode,
        retry_after=retry_after,
    )
