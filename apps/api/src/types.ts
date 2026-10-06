import type { FastifyRequest } from "fastify";
import type { AccountTier, KeyMode } from "@reckon/contracts";

/**
 * Structural view of a zod schema's `safeParse`, used so that apps/api can
 * validate against the REAL frozen schemas imported from @reckon/contracts
 * without depending on zod directly. The toolchain extension for this work
 * packet authorizes fastify only; every schema referenced below is an
 * imported contract schema (never re-declared by hand).
 */
export interface SchemaIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
  readonly code: string;
}

export type SafeParseResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: { readonly issues: readonly SchemaIssue[] } };

export interface Validator<T> {
  safeParse(input: unknown): SafeParseResult<T>;
}

/** Inferred output type of any imported contract schema (z.infer equivalent). */
export type Parsed<S> = S extends Validator<infer T> ? T : never;

/**
 * Route families gated by static API-key scopes. `research` is reserved for
 * the research runtime routes (W3 lane, later waves); no /v1 route in this
 * skeleton requires it yet, but the scope exists so key provisioning can
 * already express it. `webhooks` (S2-002) gates the /v1/webhooks route
 * family (endpoint CRUD, event retrieval, replay, delivery log).
 */
export const ROUTE_SCOPES = [
  "decisions",
  "outcomes",
  "plans",
  "catalog",
  "research",
  "agents",
  "integrations",
  "webhooks",
] as const;
export type Scope = (typeof ROUTE_SCOPES)[number];

/**
 * Authenticated identity of a request. `tenantId` (and optional workspace)
 * come EXCLUSIVELY from the API key — never from the request body. The raw
 * key is never retained; only its sha256 hash (`keyHash`) is kept, and it is
 * safe for correlation/logs.
 *
 * S2-001: `mode` is the key-scoped mode (live vs test) propagated to every
 * handler — sk_test_/pk_test_ keys (and legacy keys pinned `mode: "test"`)
 * run in test mode. Live/test behavioral separation is S2-003's surface;
 * this field is the seam it plugs into.
 *
 * TL6-001: `tier` is carried by DB-minted account keys (the paid ladder);
 * env-configured static keys have NO tier (undefined) and keep the flat
 * default rate limit. The tier-aware limiter branches on this field.
 */
export interface AuthContext {
  readonly tenantId: string;
  readonly workspaceId?: string;
  readonly scopes: ReadonlySet<Scope>;
  readonly keyHash: string;
  readonly mode: KeyMode;
  /** TL6-001: the account tier snapshot for DB-minted keys (absent for static env keys). */
  readonly tier?: AccountTier;
}

declare module "fastify" {
  interface FastifyRequest {
    /**
     * Set by the auth preHandler (see routes/shared.ts). Absence means the
     * auth middleware did not run for the route — treated as an internal
     * invariant violation.
     */
    reckonAuth?: AuthContext;
    /**
     * The RESOLVED API version for this request (pinned default, or the
     * validated X-Reckon-Version header value). Set by the /v1 preHandler;
     * echoed on every /v1 response as the x-reckon-version header.
     */
    reckonApiVersion?: string;
    /**
     * TL6-001: set by the /v1/account family's SESSION preHandler — the
     * authenticated account (resolved from the reckonsess_ bearer token)
     * plus the raw token (needed ONLY to revoke it at logout; it is never
     * logged and never leaves the request scope).
     */
    reckonAccountSession?: {
      readonly account: {
        readonly id: string;
        readonly email: string;
        readonly fullName: string;
        readonly tenantId: string;
        readonly tier: AccountTier;
      };
      readonly sessionToken: string;
    };
  }
}
