import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PAGINATION_DEFAULT_LIMIT, PAGINATION_MAX_LIMIT } from "@reckon/contracts";
import { fetchSizeFor, parsePaginationParams, slicePage } from "../src/pagination.js";
import { ApiError } from "../src/errors.js";
import {
  AGENTS_KEY,
  ALPHA,
  RESEARCH_KEY,
  authHeaders,
  buildStubServer,
  idemHeader,
  injectJson,
  validPlan,
  freshIdem,
  expectErrorEnvelope,
} from "./fixtures.js";
import type { StubServer } from "./fixtures.js";

/**
 * S2-001 cursor pagination — the edges:
 *   limit 1..100 (default 20), starting_after object-id cursors,
 *   has_more + next_cursor, stable ordering, typed 400s for malformed
 *   params and unresolvable cursors.
 */

async function seedPlans(stub: StubServer, ids: string[]): Promise<void> {
  for (const planId of ids) {
    const res = await injectJson(stub.app, "POST", "/v1/plans", {
      payload: validPlan({ planId }),
      headers: idemHeader(freshIdem(planId)),
    });
    expect(res.status).toBe(200);
  }
}

describe("pagination: param parsing (unit)", () => {
  it("defaults: limit 20, no cursor", () => {
    expect(parsePaginationParams({})).toEqual({ limit: 20 });
    expect(parsePaginationParams({ limit: "", starting_after: "" })).toEqual({ limit: 20 });
  });

  it("limit accepts 1..100; everything else is a typed 400 with param 'limit'", () => {
    expect(parsePaginationParams({ limit: "1" })).toEqual({ limit: 1 });
    expect(parsePaginationParams({ limit: "100" })).toEqual({ limit: 100 });
    for (const bad of ["0", "101", "-1", "abc", "1.5", " "]) {
      try {
        parsePaginationParams({ limit: bad });
        throw new Error(`limit '${bad}' must be rejected`);
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        expect(error.statusCode).toBe(400);
        expect(error.param).toBe("limit");
      }
    }
  });

  it("starting_after accepts a well-formed id only (typed 400 otherwise)", () => {
    expect(parsePaginationParams({ starting_after: "plan-42" })).toEqual({ limit: 20, startingAfter: "plan-42" });
    for (const bad of ["with space", "ёлка", "a".repeat(200)]) {
      try {
        parsePaginationParams({ starting_after: bad });
        throw new Error(`starting_after '${bad}' must be rejected`);
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        expect(error.statusCode).toBe(400);
        expect(error.param).toBe("starting_after");
      }
    }
  });

  it("fetchSizeFor: limit+1 for first pages; the documented scan bound for cursor resumes", () => {
    expect(fetchSizeFor({ limit: 20 })).toBe(21);
    expect(fetchSizeFor({ limit: 100 })).toBe(101);
    expect(fetchSizeFor({ limit: 20, startingAfter: "x" })).toBe(1000);
  });

  it("defaults match the frozen contract constants", () => {
    expect(PAGINATION_DEFAULT_LIMIT).toBe(20);
    expect(PAGINATION_MAX_LIMIT).toBe(100);
  });
});

describe("pagination: slice semantics (unit)", () => {
  const items = Array.from({ length: 25 }, (_, index) => ({ id: `item-${index}` }));
  const idOf = (item: { id: string }) => item.id;

  it("first page: limit items, exact has_more, next_cursor = last id", () => {
    const page = slicePage(items, { limit: 10 }, idOf);
    expect(page.items).toHaveLength(10);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe("item-9");
  });

  it("final page: has_more false, next_cursor null when exhausted", () => {
    const page = slicePage(items.slice(0, 5), { limit: 10 }, idOf);
    expect(page.items).toHaveLength(5);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBe("item-4");
    const empty = slicePage([], { limit: 10 }, idOf);
    expect(empty.nextCursor).toBeNull();
  });

  it("resume from a cursor: items strictly AFTER the anchor, no overlap", () => {
    const first = slicePage(items, { limit: 10 }, idOf);
    const second = slicePage(items, { limit: 10, startingAfter: first.nextCursor ?? "" }, idOf);
    expect(second.items.map((item) => item.id)).toEqual(
      Array.from({ length: 10 }, (_, index) => `item-${index + 10}`),
    );
    expect(second.hasMore).toBe(true);
    expect(second.nextCursor).toBe("item-19");
    const third = slicePage(items, { limit: 10, startingAfter: "item-19" }, idOf);
    expect(third.items.map((item) => item.id)).toEqual(["item-20", "item-21", "item-22", "item-23", "item-24"]);
    expect(third.hasMore).toBe(false);
  });

  it("a cursor beyond the last item: empty page, has_more false, next_cursor null", () => {
    const page = slicePage(items, { limit: 10, startingAfter: "item-24" }, idOf);
    expect(page.items).toHaveLength(0);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it("an anchor NOT present in the window → typed 400 (unresolvable cursor)", () => {
    try {
      slicePage(items, { limit: 10, startingAfter: "item-999" }, idOf);
      throw new Error("unresolvable cursor must be rejected");
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.param).toBe("starting_after");
    }
  });
});

describe("pagination: GET /v1/plans (integration)", () => {
  let stub: StubServer;

  beforeEach(() => {
    stub = buildStubServer();
  });

  afterEach(async () => {
    await stub.app.close();
  });

  it("default limit 20: first 20 of 25 newest-first, has_more true, next_cursor usable", async () => {
    await seedPlans(stub, Array.from({ length: 25 }, (_, index) => `plan-${index}`));
    const first = await injectJson(stub.app, "GET", "/v1/plans", { headers: authHeaders(ALPHA) });
    expect(first.status).toBe(200);
    const body = first.body as {
      plans?: { planId: string }[];
      has_more?: boolean;
      next_cursor?: string | null;
    };
    expect(body.plans).toHaveLength(20);
    // Stub ordering: newest first → plan-24 … plan-5.
    expect(body.plans?.[0]?.planId).toBe("plan-24");
    expect(body.plans?.[19]?.planId).toBe("plan-5");
    expect(body.has_more).toBe(true);
    expect(body.next_cursor).toBe("plan-5");

    const second = await injectJson(stub.app, "GET", `/v1/plans?starting_after=${body.next_cursor}`, {
      headers: authHeaders(ALPHA),
    });
    expect(second.status).toBe(200);
    const secondBody = second.body as { plans?: { planId: string }[]; has_more?: boolean; next_cursor?: string | null };
    expect(secondBody.plans?.map((plan) => plan.planId)).toEqual(["plan-4", "plan-3", "plan-2", "plan-1", "plan-0"]);
    expect(secondBody.has_more).toBe(false);
    expect(secondBody.next_cursor).toBe("plan-0");
  });

  it("limit=1 walks the whole list one item at a time without overlap", async () => {
    await seedPlans(stub, ["plan-w", "plan-x", "plan-y", "plan-z"]);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let step = 0; step < 5; step += 1) {
      const url = `/v1/plans?limit=1${cursor === null ? "" : `&starting_after=${cursor}`}`;
      const res = await injectJson(stub.app, "GET", url, { headers: authHeaders(ALPHA) });
      expect(res.status).toBe(200);
      const body = res.body as { plans?: { planId: string }[]; has_more?: boolean; next_cursor?: string | null };
      if (body.has_more === false && (body.plans ?? []).length === 0) break;
      seen.push(body.plans?.[0]?.planId ?? "MISSING");
      cursor = body.next_cursor ?? null;
      if (cursor === null) break;
    }
    expect(seen).toEqual(["plan-z", "plan-y", "plan-x", "plan-w"]);
  });

  it("limit=0 / 101 / malformed → typed 400 with param limit", async () => {
    for (const bad of ["0", "101", "banana"]) {
      const res = await injectJson(stub.app, "GET", `/v1/plans?limit=${bad}`, {
        headers: authHeaders(ALPHA),
      });
      expect(res.status).toBe(400);
      expectErrorEnvelope(res.status, res.body, "VALIDATION_ERROR", "invalid_request_error");
      expect((res.body as { error: { param?: string } }).error.param).toBe("limit");
    }
  });

  it("starting_after that does not resolve (unknown / cross-tenant) → typed 400", async () => {
    await seedPlans(stub, ["plan-only"]);
    const res = await injectJson(stub.app, "GET", "/v1/plans?starting_after=plan-from-another-tenant", {
      headers: authHeaders(ALPHA),
    });
    expect(res.status).toBe(400);
    expectErrorEnvelope(res.status, res.body, "VALIDATION_ERROR", "invalid_request_error");
    expect((res.body as { error: { param?: string } }).error.param).toBe("starting_after");
  });

  it("limit + expansion compose on the list route", async () => {
    await seedPlans(stub, ["plan-p1", "plan-p2", "plan-p3"]);
    const res = await injectJson(stub.app, "GET", "/v1/plans?limit=2&expand[]=queuedExperiences.item", {
      headers: authHeaders(ALPHA),
    });
    expect(res.status).toBe(200);
    const body = res.body as { plans?: unknown[]; has_more?: boolean };
    expect(body.plans).toHaveLength(2);
    expect(body.has_more).toBe(true);
  });

  it("pagination metadata composes with the X-Reckon-Version echo on list responses", async () => {
    await seedPlans(stub, ["plan-v1", "plan-v2"]);
    const res = await injectJson(stub.app, "GET", "/v1/plans?limit=1", {
      headers: authHeaders(ALPHA, { "x-reckon-version": "0.1.0" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers["x-reckon-version"]).toBe("0.1.0");
    const body = res.body as { plans?: { planId: string }[]; has_more?: boolean; next_cursor?: string };
    expect(body.plans).toHaveLength(1);
    expect(body.plans?.[0]?.planId).toBe("plan-v2");
    expect(body.has_more).toBe(true);
    expect(body.next_cursor).toBe("plan-v2");
  });
});

describe("pagination: other list routes", () => {
  it("GET /v1/agents/bodies: same pagination contract (empty list: has_more false, next_cursor null)", async () => {
    const stub = buildStubServer();
    try {
      const res = await injectJson(stub.app, "GET", "/v1/agents/bodies", { headers: authHeaders(AGENTS_KEY) });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ bodies: [], has_more: false, next_cursor: null });
    } finally {
      await stub.app.close();
    }
  });

  it("GET /v1/research/jobs: state filter composes with pagination params", async () => {
    const stub = buildStubServer();
    try {
      const bad = await injectJson(stub.app, "GET", "/v1/research/jobs?state=bogus", {
        headers: authHeaders(RESEARCH_KEY),
      });
      expect(bad.status).toBe(400);
      expectErrorEnvelope(bad.status, bad.body, "VALIDATION_ERROR", "invalid_request_error");
      expect((bad.body as { error: { param?: string } }).error.param).toBe("state");

      const ok = await injectJson(stub.app, "GET", "/v1/research/jobs?state=queued&limit=5", {
        headers: authHeaders(RESEARCH_KEY),
      });
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({ jobs: [], has_more: false, next_cursor: null });
    } finally {
      await stub.app.close();
    }
  });
});
