/**
 * Developer-platform surface tests (S3-001) — the honest outcome
 * mapping: every observed API behavior maps to a typed outcome, wire
 * shapes parse strictly, and nothing is ever fabricated. Uses an
 * injected fetch (no network).
 */
import { describe, expect, it } from "vitest";
import {
  PENDING_API_KEY_ROUTES,
  PENDING_EVENT_ROUTES,
  PENDING_REQUEST_LOG_ROUTE,
  createApiKey,
  listApiKeys,
  listEvents,
  listRequestLogs,
  parseApiKeysPage,
  parseCreatedApiKey,
  parseEventsPage,
  parsePaginationEnvelope,
  parseRequestLogsPage,
  revokeApiKey,
  type FetchLike,
  type SurfaceEndpoint,
} from "../src/lib/developers-api.js";

const endpoint: SurfaceEndpoint = { baseUrl: "http://127.0.0.1:8080", apiKey: "sk_test_a".padEnd(32, "x") };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fetchReturning(responses: Response[]): FetchLike {
  let index = 0;
  return () => {
    const response = responses[index];
    index += 1;
    if (response === undefined) {
      throw new Error("unexpected extra fetch call");
    }
    return Promise.resolve(response);
  };
}

/* ---------------- wire-shape guards ---------------- */

describe("pagination envelope guard (the S2-001 shape)", () => {
  it("accepts the exact envelope", () => {
    expect(parsePaginationEnvelope({ has_more: true, next_cursor: "req_9" })).toEqual({
      has_more: true,
      next_cursor: "req_9",
    });
    expect(parsePaginationEnvelope({ has_more: false, next_cursor: null })).toEqual({
      has_more: false,
      next_cursor: null,
    });
  });

  it("rejects anything else — strictly", () => {
    expect(parsePaginationEnvelope({ has_more: "yes" })).toBeNull();
    expect(parsePaginationEnvelope({ has_more: true, next_cursor: 7 })).toBeNull();
    expect(parsePaginationEnvelope(null)).toBeNull();
    expect(parsePaginationEnvelope({})).toBeNull();
  });
});

describe("keys/logs/events page guards", () => {
  it("parses a well-formed keys page (pagination optional)", () => {
    const page = parseApiKeysPage({
      data: [
        {
          id: "key-1",
          name: "prod",
          prefix: "sk_live_…9f2K",
          mode: "live",
          kind: "secret",
          created_at: "2026-10-03T10:00:00Z",
          last_used_at: null,
        },
      ],
      pagination: { has_more: false, next_cursor: null },
    });
    expect(page?.keys).toHaveLength(1);
    expect(page?.keys[0]?.name).toBe("prod");

    const noPagination = parseApiKeysPage({ data: [] });
    expect(noPagination?.pagination).toBeNull();
  });

  it("rejects malformed key rows entirely (never pads defaults)", () => {
    expect(parseApiKeysPage({ data: [{ id: "key-1" }] })).toBeNull();
    expect(parseApiKeysPage({ data: [{ ...validKeyRow(), mode: "prod" }] })).toBeNull();
    expect(parseApiKeysPage({ data: "nope" })).toBeNull();
    expect(parseApiKeysPage({ data: [] }, )?.keys).toEqual([]);
  });

  it("parses a created key ONLY with a full secret", () => {
    expect(parseCreatedApiKey({ ...validKeyRow(), secret: "sk_test_" + "a".repeat(30) })).not.toBeNull();
    expect(parseCreatedApiKey(validKeyRow())).toBeNull();
    expect(parseCreatedApiKey({ ...validKeyRow(), secret: "" })).toBeNull();
  });

  it("parses logs pages strictly (every row field required)", () => {
    const page = parseRequestLogsPage({
      data: [
        {
          id: "req-1",
          created_at: "2026-10-03T10:00:00Z",
          method: "POST",
          route: "POST /v1/decisions",
          status: 200,
          latency_ms: 142,
          key_prefix: "sk_test_…9f2K",
        },
      ],
      pagination: { has_more: true, next_cursor: "req-1" },
    });
    expect(page?.logs[0]?.status).toBe(200);
    expect(page?.pagination.next_cursor).toBe("req-1");

    expect(
      parseRequestLogsPage({
        data: [{ id: "req-1", method: "POST", route: "/v1/decisions", status: 200, latency_ms: 142, key_prefix: "x" }],
        pagination: { has_more: true, next_cursor: "req-1" },
      }),
    ).toBeNull();
  });

  it("parses events pages (status is any reported string)", () => {
    const page = parseEventsPage({
      data: [{ id: "evt-1", type: "recommendation.delivered", created_at: "2026-10-03T10:00:00Z", status: "delivered" }],
      pagination: { has_more: false, next_cursor: null },
    });
    expect(page?.events[0]?.type).toBe("recommendation.delivered");
    expect(parseEventsPage({ data: [{ id: "evt-1", type: "x" }], pagination: { has_more: false, next_cursor: null } })).toBeNull();
  });
});

function validKeyRow() {
  return {
    id: "key-1",
    name: "prod",
    prefix: "sk_live_…9f2K",
    mode: "live",
    kind: "secret",
    created_at: "2026-10-03T10:00:00Z",
    last_used_at: null,
  };
}

/* ---------------- honest outcome mapping ---------------- */

describe("listApiKeys — observed outcomes", () => {
  it("unconfigured when the studio has no demo key (before any fetch)", async () => {
    const calls: string[] = [];
    const result = await listApiKeys(
      { baseUrl: "http://x", apiKey: "  " },
      () => {
        calls.push("called");
        return Promise.resolve(jsonResponse(200, { data: [] }));
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.outcome).toBe("unconfigured");
      expect(result.failure.detail).toContain("RECKON_DEMO_API_KEY");
    }
    expect(calls).toEqual([]);
  });

  it("unreachable maps the observed network failure", async () => {
    const result = await listApiKeys(endpoint, () => Promise.reject(new Error("ECONNREFUSED boom")));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.outcome).toBe("unreachable");
      expect(result.failure.detail).toContain("ECONNREFUSED boom");
      expect(result.failure.pendingRoute).toBe(PENDING_API_KEY_ROUTES.list);
    }
  });

  it("404 and 501 are NOT-WIRED with the pending route named verbatim", async () => {
    for (const status of [404, 501]) {
      const result = await listApiKeys(
        endpoint,
        fetchReturning([jsonResponse(status, { error: { class: "api_error", code: "NOT_WIRED", message: "no mounted handler" } })]),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.outcome).toBe("not-wired");
        expect(result.failure.httpStatus).toBe(status);
        expect(result.failure.pendingRoute).toBe("GET /v1/api-keys");
        expect(result.failure.detail).toContain("GET /v1/api-keys");
        expect(result.failure.detail).toContain("NOT_WIRED");
      }
    }
  });

  it("other statuses are honest errors, envelopes included verbatim", async () => {
    const result = await listApiKeys(
      endpoint,
      fetchReturning([jsonResponse(403, { error: { class: "permission_error", code: "INSUFFICIENT_SCOPE", message: "key lacks scope" } })]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.outcome).toBe("error");
      expect(result.failure.httpStatus).toBe(403);
      expect(result.failure.detail).toContain("INSUFFICIENT_SCOPE");
    }
  });

  it("200 with a wrong-shaped body is an ERROR — never reshaped or padded", async () => {
    const result = await listApiKeys(endpoint, fetchReturning([jsonResponse(200, { data: "nope" })]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.outcome).toBe("error");
      expect(result.failure.detail).toContain("did not match");
    }
  });

  it("200 with a matching page flows through as ok", async () => {
    const result = await listApiKeys(
      endpoint,
      fetchReturning([jsonResponse(200, { data: [validKeyRow()], pagination: { has_more: false, next_cursor: null } })]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.keys).toHaveLength(1);
    }
  });

  it("200 with a non-JSON body is an honest error", async () => {
    const result = await listApiKeys(
      endpoint,
      fetchReturning([new Response("<html>not json</html>", { status: 200 })]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.outcome).toBe("error");
      expect(result.failure.detail).toContain("not valid JSON");
    }
  });
});

describe("createApiKey / revokeApiKey — request + outcome shapes", () => {
  it("create posts the typed body with the bearer header and parses the secret", async () => {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    const result = await createApiKey(endpoint, { name: "mobile", kind: "publishable", mode: "test" }, (url, init) => {
      seenUrl = url;
      seenInit = init;
      return Promise.resolve(
        jsonResponse(200, { ...validKeyRow(), kind: "publishable", mode: "test", secret: "pk_test_" + "b".repeat(30) }),
      );
    });
    expect(seenUrl).toBe("http://127.0.0.1:8080/v1/api-keys");
    expect(seenInit?.method).toBe("POST");
    const headers = seenInit?.headers as Record<string, string>;
    expect(headers["authorization"]).toBe(`Bearer ${endpoint.apiKey}`);
    expect(JSON.parse(String(seenInit?.body))).toEqual({ name: "mobile", kind: "publishable", mode: "test" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.secret).toContain("pk_test_");
    }
  });

  it("create on a not-wired route reports the pending CREATE route", async () => {
    const result = await createApiKey(endpoint, { name: "mobile", kind: "secret", mode: "live" }, fetchReturning([jsonResponse(404, {})]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.outcome).toBe("not-wired");
      expect(result.failure.pendingRoute).toBe(PENDING_API_KEY_ROUTES.create);
    }
  });

  it("revoke targets the key id and names the route with the id substituted", async () => {
    let seenUrl = "";
    let seenMethod = "";
    const result = await revokeApiKey(endpoint, "key_42", (url, init) => {
      seenUrl = url;
      seenMethod = init?.method ?? "";
      return Promise.resolve(jsonResponse(200, { revoked: true }));
    });
    expect(seenUrl).toBe("http://127.0.0.1:8080/v1/api-keys/key_42");
    expect(seenMethod).toBe("DELETE");
    expect(result.ok).toBe(true);

    const failed = await revokeApiKey(endpoint, "key_42", fetchReturning([jsonResponse(501, {})]));
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.failure.pendingRoute).toBe("DELETE /v1/api-keys/key_42");
    }
  });
});

describe("listRequestLogs / listEvents — cursor params follow the S2-001 envelope", () => {
  it("logs pass starting_after + limit through, unchanged", async () => {
    let seenUrl = "";
    const result = await listRequestLogs(endpoint, { startingAfter: "req-7", limit: 25 }, (url) => {
      seenUrl = url;
      return Promise.resolve(
        jsonResponse(200, {
          data: [
            {
              id: "req-8",
              created_at: "2026-10-03T10:00:00Z",
              method: "GET",
              route: "GET /v1/plans",
              status: 200,
              latency_ms: 12,
              key_prefix: "sk_test_…9f2K",
            },
          ],
          pagination: { has_more: false, next_cursor: null },
        }),
      );
    });
    expect(seenUrl).toBe("http://127.0.0.1:8080/v1/request-logs?starting_after=req-7&limit=25");
    expect(result.ok).toBe(true);
  });

  it("logs without options hit the bare route", async () => {
    let seenUrl = "";
    await listRequestLogs(endpoint, {}, (url) => {
      seenUrl = url;
      return Promise.resolve(jsonResponse(200, { data: [], pagination: { has_more: false, next_cursor: null } }));
    });
    expect(seenUrl).toBe("http://127.0.0.1:8080/v1/request-logs");
  });

  it("logs 404 → not-wired naming GET /v1/request-logs", async () => {
    const result = await listRequestLogs(endpoint, {}, fetchReturning([jsonResponse(404, {})]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.pendingRoute).toBe(PENDING_REQUEST_LOG_ROUTE);
    }
  });

  it("events pass the cursor and name the events route on 404", async () => {
    let seenUrl = "";
    await listEvents(endpoint, { startingAfter: "evt-3" }, (url) => {
      seenUrl = url;
      return Promise.resolve(jsonResponse(200, { data: [], pagination: { has_more: false, next_cursor: null } }));
    });
    expect(seenUrl).toBe("http://127.0.0.1:8080/v1/events?starting_after=evt-3");

    const failed = await listEvents(endpoint, {}, fetchReturning([jsonResponse(404, {})]));
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.failure.pendingRoute).toBe(PENDING_EVENT_ROUTES.list);
    }
  });
});
