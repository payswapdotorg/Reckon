/**
 * Request-logs view tests (S3-001) — the cursor pagination controls:
 * URL ⇄ cursor-state parsing, next/prev href math on the S2-001
 * forward-only envelope, page counting and row view models.
 */
import { describe, expect, it } from "vitest";
import {
  FIRST_LOGS_PAGE,
  STARTING_AFTER_PARAM,
  CURSOR_HISTORY_PARAM,
  isValidCursor,
  logsPageNumber,
  nextLogsHref,
  parseLogsCursorParams,
  prevLogsHref,
  requestLogRowView,
  statusToneFor,
} from "../src/lib/request-logs-view.js";
import type { RequestLogRecord } from "../src/lib/developers-api.js";

describe("cursor validation", () => {
  it("accepts non-empty, comma-free, bounded cursors", () => {
    expect(isValidCursor("req-1")).toBe(true);
    expect(isValidCursor("a")).toBe(true);
    expect(isValidCursor("")).toBe(false);
    expect(isValidCursor("a,b")).toBe(false);
    expect(isValidCursor("x".repeat(129))).toBe(false);
  });
});

describe("URL ⇄ cursor state", () => {
  it("no params = the first page", () => {
    expect(parseLogsCursorParams({})).toEqual(FIRST_LOGS_PAGE);
  });

  it("parses starting_after + cursor_history", () => {
    const state = parseLogsCursorParams({
      [STARTING_AFTER_PARAM]: "req-5",
      [CURSOR_HISTORY_PARAM]: "req-1,req-3",
    });
    expect(state).toEqual({ current: "req-5", history: ["req-1", "req-3"] });
  });

  it("sanitizes malformed values instead of crashing (hand-edited URLs)", () => {
    const state = parseLogsCursorParams({
      [STARTING_AFTER_PARAM]: "bad,cursor",
      [CURSOR_HISTORY_PARAM]: "req-1,,no,,pe,",
    });
    expect(state.current).toBeNull();
    expect(state.history).toEqual(["req-1", "no", "pe"]);
  });

  it("accepts array-valued params by using the first entry", () => {
    const state = parseLogsCursorParams({ [STARTING_AFTER_PARAM]: ["req-9", "req-1"] });
    expect(state.current).toBe("req-9");
  });

  it("ignores non-string junk", () => {
    const state = parseLogsCursorParams({ [STARTING_AFTER_PARAM]: undefined, [CURSOR_HISTORY_PARAM]: "" });
    expect(state).toEqual(FIRST_LOGS_PAGE);
  });
});

describe("next (Older) — advances one cursor step", () => {
  it("requires has_more AND a next_cursor", () => {
    const state = FIRST_LOGS_PAGE;
    expect(nextLogsHref(state, { has_more: false, next_cursor: null })).toBeNull();
    expect(nextLogsHref(state, { has_more: true, next_cursor: null })).toBeNull();
    expect(nextLogsHref(state, { has_more: false, next_cursor: "req-1" })).toBeNull();
  });

  it("from the first page: current becomes next_cursor, trail stays empty", () => {
    const href = nextLogsHref(FIRST_LOGS_PAGE, { has_more: true, next_cursor: "req-20" });
    expect(href).toBe(`/developers/logs?${STARTING_AFTER_PARAM}=req-20`);
  });

  it("from a deep page: the current cursor is pushed onto the trail", () => {
    const state = { current: "req-20", history: ["req-5"] };
    const href = nextLogsHref(state, { has_more: true, next_cursor: "req-40" });
    expect(href).toBe(`/developers/logs?${STARTING_AFTER_PARAM}=req-40&${CURSOR_HISTORY_PARAM}=req-5%2Creq-20`);
  });
});

describe("prev (Newer) — steps back along the trail", () => {
  it("null on the first page", () => {
    expect(prevLogsHref(FIRST_LOGS_PAGE)).toBeNull();
  });

  it("from the first cursor deep page: returns to the parameterless first page", () => {
    expect(prevLogsHref({ current: "req-20", history: [] })).toBe("/developers/logs");
  });

  it("from a deep page: pops the trail", () => {
    const href = prevLogsHref({ current: "req-40", history: ["req-5", "req-20"] });
    expect(href).toBe(`/developers/logs?${STARTING_AFTER_PARAM}=req-20&${CURSOR_HISTORY_PARAM}=req-5`);
  });

  it("an empty trail entry is never produced", () => {
    const href = prevLogsHref({ current: "req-5", history: ["req-1"] });
    expect(href).toBe(`/developers/logs?${STARTING_AFTER_PARAM}=req-1`);
  });
});

describe("page counting (honest: position, not totals)", () => {
  it("counts the trail", () => {
    expect(logsPageNumber(FIRST_LOGS_PAGE)).toBe(1);
    expect(logsPageNumber({ current: "req-20", history: [] })).toBe(1);
    expect(logsPageNumber({ current: "req-40", history: ["req-5", "req-20"] })).toBe(3);
  });
});

describe("row view models", () => {
  const record: RequestLogRecord = {
    id: "req-1",
    created_at: "2026-10-03T10:00:00.000Z",
    method: "POST",
    route: "POST /v1/decisions",
    status: 200,
    latency_ms: 142,
    key_prefix: "sk_test_…9f2K",
  };

  it("maps the six columns verbatim (time formatted, latency labeled)", () => {
    const row = requestLogRowView(record, (iso) => iso.slice(11, 19));
    expect(row).toMatchObject({
      method: "POST",
      route: "POST /v1/decisions",
      status: 200,
      statusTone: "ok",
      latencyLabel: "142 ms",
      keyPrefix: "sk_test_…9f2K",
      createdLabel: "10:00:00",
    });
  });

  it("status tones: 2xx/3xx ok, 4xx warn, 5xx error", () => {
    expect(statusToneFor(200)).toBe("ok");
    expect(statusToneFor(302)).toBe("ok");
    expect(statusToneFor(404)).toBe("warn");
    expect(statusToneFor(422)).toBe("warn");
    expect(statusToneFor(500)).toBe("error");
    expect(statusToneFor(501)).toBe("error");
  });
});
