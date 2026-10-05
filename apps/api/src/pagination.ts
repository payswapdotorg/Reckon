import {
  IdSchema,
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_MAX_LIMIT,
  PAGINATION_SCAN_MAX,
} from "@reckon/contracts";
import { ApiError, ERROR_CODES } from "./errors.js";

/**
 * Cursor pagination (S2-001, Stripe-style):
 *
 * - `limit` — integer 1..100 (default 20); anything else is a typed 400
 *   naming `limit` as the param.
 * - `starting_after` — an OBJECT-ID cursor: the id of the last item of
 *   the previous page. Anything that is not a well-formed id is a typed
 *   400 naming `starting_after`; a well-formed id whose anchor cannot be
 *   found in the scan window is rejected the same way (a cursor from
 *   another tenant or older than the scan bound is never resolvable).
 * - Responses carry `has_more` + `next_cursor` (the id of the last item
 *   of this page — feed it straight back as starting_after; null when
 *   the page is empty or the list is exhausted).
 *
 * STABLE ORDERING CONTRACT: list endpoints return items newest-first in
 * the handler's documented order (creation/update recency; see each
 * route). Pagination is a stable slice of that order: the engine asks
 * the handler for `limit + 1` items (or up to PAGINATION_SCAN_MAX when
 * resuming from a cursor), so `has_more` is exact and pages never
 * overlap. If items are inserted between calls, a new insert can appear
 * on the next page — that is inherent to newest-first ordering and
 * documented here.
 */

export interface ParsedPaginationParams {
  readonly limit: number;
  readonly startingAfter?: string;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}

/** How many items to ask the handler for (limit + 1 detects has_more exactly; cursor resume scans the documented bound). */
export function fetchSizeFor(params: ParsedPaginationParams): number {
  return params.startingAfter === undefined ? params.limit + 1 : PAGINATION_SCAN_MAX;
}

type QueryRecord = Record<string, unknown>;

function firstValue(raw: unknown): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value : undefined;
}

/**
 * Parse `limit` + `starting_after` from a fastify query object. Typed
 * 400s (param-carrying) for anything malformed.
 */
export function parsePaginationParams(query: QueryRecord): ParsedPaginationParams {
  const rawLimit = firstValue(query["limit"]);
  let limit = PAGINATION_DEFAULT_LIMIT;
  if (rawLimit !== undefined && rawLimit !== "") {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > PAGINATION_MAX_LIMIT) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_ERROR,
        400,
        `limit must be an integer 1..${PAGINATION_MAX_LIMIT}, got '${rawLimit}'`,
        { limit: rawLimit },
        "limit",
      );
    }
    limit = parsed;
  }
  const rawStartingAfter = firstValue(query["starting_after"]);
  if (rawStartingAfter !== undefined && rawStartingAfter !== "") {
    if (!IdSchema.safeParse(rawStartingAfter).success) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_ERROR,
        400,
        `starting_after must be a well-formed object id cursor, got '${rawStartingAfter}'`,
        { starting_after: rawStartingAfter },
        "starting_after",
      );
    }
    return { limit, startingAfter: rawStartingAfter };
  }
  return { limit };
}

/**
 * Slice a fetched window into the response page. `items` must be the
 * handler-ordered window the route fetched (fetchSizeFor). `idOf`
 * extracts the stable cursor id of each item.
 */
export function slicePage<T>(
  items: readonly T[],
  params: ParsedPaginationParams,
  idOf: (item: T) => string,
): Page<T> {
  let offset = 0;
  if (params.startingAfter !== undefined) {
    const anchorIndex = items.findIndex((item) => idOf(item) === params.startingAfter);
    if (anchorIndex < 0) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_ERROR,
        400,
        `starting_after cursor '${params.startingAfter}' does not resolve inside this list (unknown id, cross-tenant cursor, or older than the ${PAGINATION_SCAN_MAX}-item scan bound)`,
        { starting_after: params.startingAfter },
        "starting_after",
      );
    }
    offset = anchorIndex + 1;
  }
  const end = offset + params.limit;
  const page = items.slice(offset, end);
  const hasMore = end < items.length;
  const last = page.length > 0 ? page[page.length - 1] : undefined;
  return {
    items: page,
    hasMore,
    nextCursor: last === undefined ? null : idOf(last),
  };
}

/** The response meta block every hardened list endpoint appends. */
export function paginationMeta<T>(page: Page<T>): { has_more: boolean; next_cursor: string | null } {
  return { has_more: page.hasMore, next_cursor: page.nextCursor };
}
