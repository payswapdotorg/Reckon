/**
 * Request-logs view models + cursor pagination (S3-001) — PURE logic,
 * unit-tested in test/request-logs-view.test.ts.
 *
 * Data shape follows the S2-001 pagination envelope exactly:
 * `?limit=&starting_after=` requests, `{ data, pagination:
 * { has_more, next_cursor } }` responses, `next_cursor` fed back as
 * `starting_after`. There is no page arithmetic — only cursor steps.
 *
 * PAGING BACKWARDS: the API's envelope is forward-only (starting_after),
 * so the dashboard keeps the cursor trail in the URL — `cursor_history`
 * holds the cursors of the pages BEFORE the current one. "Newer" pops
 * the trail, "Older" advances to next_cursor and pushes the current
 * cursor. Server-rendered, shareable, JS-optional; the href math below
 * is the whole controller.
 */

import type { RequestLogRecord } from "./developers-api.js";

/* ================================================================== *
 * Cursor trail (URL ⇄ state)
 * ================================================================== */

export const STARTING_AFTER_PARAM = "starting_after";
export const CURSOR_HISTORY_PARAM = "cursor_history";

export interface LogsCursorState {
  /** Cursor of the CURRENT page (null = first page). */
  readonly current: string | null;
  /** Cursors of the pages before the current one, oldest first. */
  readonly history: readonly string[];
}

export const FIRST_LOGS_PAGE: LogsCursorState = { current: null, history: [] };

/** A valid cursor: non-empty, comma-free (the trail is comma-joined). */
export function isValidCursor(value: string): boolean {
  return value.length > 0 && !value.includes(",") && value.length <= 128;
}

/** Parse the raw searchParams (unknown shapes) into a sanitized cursor state. */
export function parseLogsCursorParams(
  params: Record<string, string | string[] | undefined>,
): LogsCursorState {
  const rawCurrent = firstParam(params, STARTING_AFTER_PARAM);
  const rawHistory = firstParam(params, CURSOR_HISTORY_PARAM);

  const current = rawCurrent !== null && isValidCursor(rawCurrent) ? rawCurrent : null;
  const history =
    rawHistory === null
      ? []
      : rawHistory
          .split(",")
          .filter((entry) => isValidCursor(entry));

  return { current, history };
}

function firstParam(params: Record<string, string | string[] | undefined>, name: string): string | null {
  const value = params[name];
  if (typeof value === "string" && value.length > 0) return value;
  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === "string" && entry.length > 0);
    return first ?? null;
  }
  return null;
}

function hrefFor(state: LogsCursorState): string {
  const params = new URLSearchParams();
  if (state.current !== null) {
    params.set(STARTING_AFTER_PARAM, state.current);
  }
  if (state.history.length > 0) {
    params.set(CURSOR_HISTORY_PARAM, state.history.join(","));
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return `/developers/logs${query}`;
}

/**
 * "Older" — advance one page. Requires has_more AND a next_cursor (the
 * S2-001 envelope: null means exhausted). Returns null when there is no
 * next page (control renders disabled).
 */
export function nextLogsHref(
  state: LogsCursorState,
  pagination: { readonly has_more: boolean; readonly next_cursor: string | null },
): string | null {
  if (!pagination.has_more || pagination.next_cursor === null) {
    return null;
  }
  const history = state.current === null ? [...state.history] : [...state.history, state.current];
  return hrefFor({ current: pagination.next_cursor, history });
}

/**
 * "Newer" — step back one page. Null on the first page (control renders
 * disabled). From a deep page: current becomes the last history entry;
 * when the trail empties, the step lands on the FIRST page (no params).
 */
export function prevLogsHref(state: LogsCursorState): string | null {
  if (state.current === null && state.history.length === 0) {
    return null;
  }
  if (state.history.length === 0) {
    return hrefFor(FIRST_LOGS_PAGE);
  }
  const history = state.history.slice(0, -1);
  const current = state.history[state.history.length - 1] ?? null;
  return hrefFor({ current, history });
}

/** 1-based position of the current page (the trail length + 1). Honest counting, no totals. */
export function logsPageNumber(state: LogsCursorState): number {
  return state.history.length + 1;
}

/* ================================================================== *
 * Row view model
 * ================================================================== */

export interface RequestLogRowView {
  readonly id: string;
  readonly createdLabel: string;
  readonly method: string;
  readonly route: string;
  readonly status: number;
  /** Status class for coloring: ok (2xx/3xx), warn (4xx), error (5xx). */
  readonly statusTone: "ok" | "warn" | "error";
  readonly latencyLabel: string;
  readonly keyPrefix: string;
}

export function statusToneFor(status: number): "ok" | "warn" | "error" {
  if (status >= 500) return "error";
  if (status >= 400) return "warn";
  return "ok";
}

export function requestLogRowView(
  record: RequestLogRecord,
  formatTime: (iso: string) => string = (iso) => iso,
): RequestLogRowView {
  return {
    id: record.id,
    createdLabel: formatTime(record.created_at),
    method: record.method,
    route: record.route,
    status: record.status,
    statusTone: statusToneFor(record.status),
    latencyLabel: `${record.latency_ms} ms`,
    keyPrefix: record.key_prefix,
  };
}

export function requestLogRowsView(
  records: readonly RequestLogRecord[],
  formatTime?: (iso: string) => string,
): readonly RequestLogRowView[] {
  return records.map((record) => requestLogRowView(record, formatTime));
}
