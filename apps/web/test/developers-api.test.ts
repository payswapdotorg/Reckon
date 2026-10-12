/**
 * Developer-platform surface tests (S3-001 + TL6-003) — the honest outcome
 * mapping: every observed API behavior maps to a typed outcome, wire
 * shapes parse strictly, and nothing is ever fabricated. Uses an
 * injected fetch (no network).
 *
 * TL6-003: the KEY-management suites moved to the ACCOUNT lane — see
 * test/account-api.test.ts (POST/GET/DELETE /v1/account/**). This file
 * keeps the request-log and webhook-event surfaces (the still-pending
 * S2-002/S2-003 routes).
 */
import { describe, expect, it } from "vitest";
import {
  PENDING_EVENT_ROUTES,
  PENDING_REQUEST_LOG_ROUTE,
  listEvents,
  listRequestLogs,
  parseEventsPage,
  parsePaginationEnvelope,
  parseRequestLogsPage,
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

  it("rejects malformed envelopes", () => {
    expect(parsePaginationEnvelope({ has_more: "yes" })).toBeNull();
    expect(parsePaginationEnvelope({ has_more: true, next_cursor: 7 })).toBeNull();
    expect(parsePaginationEnvelope(null)).toBeNull();
  });
});

describe("logs/events page guards", () => {
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

/* ---------------- honest outcome mapping ---------------- */

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
