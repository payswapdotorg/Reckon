import type { FastifyRequest } from "fastify";

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
 * already express it.
 */
export const ROUTE_SCOPES = ["decisions", "outcomes", "plans", "catalog", "research"] as const;
export type Scope = (typeof ROUTE_SCOPES)[number];

/**
 * Authenticated identity of a request. `tenantId` (and optional workspace)
 * come EXCLUSIVELY from the API key — never from the request body. The raw
 * key is never retained; only its sha256 hash (`keyHash`) is kept, and it is
 * safe for correlation/logs.
 */
export interface AuthContext {
  readonly tenantId: string;
  readonly workspaceId?: string;
  readonly scopes: ReadonlySet<Scope>;
  readonly keyHash: string;
}

declare module "fastify" {
  interface FastifyRequest {
    /**
     * Set by the auth preHandler (see routes/shared.ts). Absence means the
     * auth middleware did not run for the route — treated as an internal
     * invariant violation.
     */
    reckonAuth?: AuthContext;
  }
}
