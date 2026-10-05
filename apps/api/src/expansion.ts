import {
  EXPAND_MAX_DEPTH,
  EXPAND_MAX_PATHS,
  EXPAND_QUERY_KEYS,
  ExpandPathTokenSchema,
  type ExpansionAllowlist,
  type ExpansionRequest,
} from "@reckon/contracts";
import { ApiError, ERROR_CODES } from "./errors.js";

/**
 * Response expansion (S2-001, Stripe-style): `?expand[]=field.subfield`
 * on hardened detail/list endpoints. Resolved expansions are EMBEDDED in
 * the response next to (never replacing) the contract fields — the
 * expanded payload is the validated frozen contract PLUS the expanded
 * reference objects, so non-expanding clients see no change.
 *
 * - Unknown expand fields are a typed 400 invalid_request_error with
 *   `param: expand[i]` (per-route allowlists below).
 * - Paths are dot-joined for nesting (`queuedExperiences.item` embeds
 *   each queued experience's catalog item).
 * - Expansions that need an unwired port surface as 501 NOT_WIRED (same
 *   law as any other handler port).
 */

/** One parsed expand path (`field.subfield` → ["field", "subfield"]). */
export type ExpandPath = readonly [string, ...string[]];

/** Parse + validate the expand query against a route's allowlist. */
export function parseExpansion(
  query: Record<string, unknown>,
  allowlist: ExpansionAllowlist,
): ExpansionRequest {
  const rawPaths: string[] = [];
  for (const key of EXPAND_QUERY_KEYS) {
    const raw = query[key];
    if (raw === undefined) continue;
    if (Array.isArray(raw)) {
      for (const value of raw) {
        if (typeof value === "string" && value.length > 0) rawPaths.push(value);
      }
    } else if (typeof raw === "string" && raw.length > 0) {
      rawPaths.push(raw);
    }
  }
  if (rawPaths.length === 0) return [];
  if (rawPaths.length > EXPAND_MAX_PATHS) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_ERROR,
      400,
      `Too many expand paths (max ${EXPAND_MAX_PATHS}, got ${rawPaths.length})`,
      undefined,
      "expand",
    );
  }
  const parsed: [string, ...string[]][] = [];
  for (const [index, rawPath] of rawPaths.entries()) {
    const param = `expand[${index}]`;
    const tokens = rawPath.split(".");
    if (tokens.length > EXPAND_MAX_DEPTH) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_ERROR,
        400,
        `Expand path '${rawPath}' exceeds the maximum nesting depth of ${EXPAND_MAX_DEPTH}`,
        undefined,
        param,
      );
    }
    const validated = tokens.map((token) => {
      const result = ExpandPathTokenSchema.safeParse(token);
      if (!result.success) {
        throw new ApiError(
          ERROR_CODES.VALIDATION_ERROR,
          400,
          `Expand path '${rawPath}' contains an invalid segment '${token}'`,
          undefined,
          param,
        );
      }
      return result.data;
    });
    if (validated.length === 0) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 400, `Expand path must not be empty`, undefined, param);
    }
    // Walk the allowlist tree: every segment must be expandable at its level.
    let level: ExpansionAllowlist = allowlist;
    for (const token of validated) {
      if (!Object.prototype.hasOwnProperty.call(level, token)) {
        throw new ApiError(
          ERROR_CODES.VALIDATION_ERROR,
          400,
          `Unknown expand field '${rawPath}' (expandable here: ${Object.keys(allowlist).join(", ") || "none"})`,
          { expandable: Object.keys(allowlist) },
          param,
        );
      }
      const next = level[token];
      level = next ?? {};
    }
    const [head, ...tail] = validated;
    parsed.push([head, ...tail] as [string, ...string[]]);
  }
  return parsed;
}

/** True when the request asked for the given root field. */
export function wantsExpand(expansion: ExpansionRequest, rootField: string): boolean {
  return expansion.some((path) => path.length > 0 && path[0] === rootField);
}

/** True when the request asked for field.subfield (exactly this nesting). */
export function wantsNestedExpand(expansion: ExpansionRequest, rootField: string, subField: string): boolean {
  return expansion.some((path) => path.length >= 2 && path[0] === rootField && path[1] === subField);
}
