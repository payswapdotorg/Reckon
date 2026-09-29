import type { FastifyRequest } from "fastify";
import type { TenantScope } from "@reckon/contracts";
import { ApiError, ERROR_CODES } from "./errors.js";
import type { AuthContext } from "./types.js";

/**
 * THE TENANT LAW: tenantId is authenticated from the API key. A request's
 * body tenant MUST match the authenticated tenant or the request is
 * rejected 403 — never trust the body alone.
 *
 * Matching rules (applied to the body tenant, the advisory
 * X-Reckon-Tenant header, and handler-produced responses alike):
 * - body/header tenantId must equal the authenticated tenantId;
 * - a workspace-scoped key must operate within its workspace: if the key
 *   has workspaceId, the request/response tenant must carry the SAME
 *   workspaceId;
 * - a tenant-wide key (no workspaceId) may target any workspace of its
 *   tenant, or the tenant as a whole.
 */
function mismatch(auth: AuthContext, tenant: TenantScope): ApiError {
  return new ApiError(
    ERROR_CODES.TENANT_MISMATCH,
    403,
    `Request tenant '${tenant.tenantId}' does not match the authenticated tenant '${auth.tenantId}'`,
    { authenticatedTenantId: auth.tenantId, requestTenantId: tenant.tenantId },
  );
}

function tenantMatches(auth: AuthContext, tenant: TenantScope): boolean {
  if (tenant.tenantId !== auth.tenantId) return false;
  if (auth.workspaceId !== undefined && tenant.workspaceId !== auth.workspaceId) return false;
  return true;
}

/** Body tenant vs authenticated tenant → 403 TENANT_MISMATCH. */
export function assertRequestTenant(auth: AuthContext, tenant: TenantScope): void {
  if (!tenantMatches(auth, tenant)) throw mismatch(auth, tenant);
}

/**
 * Handler-produced response tenant vs authenticated tenant → 500
 * HANDLER_TENANT_VIOLATION. Cross-tenant data must never reach a client,
 * even through a buggy handler.
 */
export function assertResponseTenant(auth: AuthContext, tenant: TenantScope): void {
  if (!tenantMatches(auth, tenant)) {
    throw new ApiError(
      ERROR_CODES.HANDLER_TENANT_VIOLATION,
      500,
      "Handler produced a response belonging to a different tenant than the authenticated one; the response was withheld",
      { authenticatedTenantId: auth.tenantId },
    );
  }
}

/**
 * Advisory tenant header. The header never AUTHORIZES anything (the key
 * does); it exists so tenant-carrying routes whose frozen contracts have no
 * tenant field (catalog, candidates, resolve, replan) still expose a
 * checkable tenant boundary: if present it must match, else 403.
 */
export function assertTenantHeader(auth: AuthContext, request: FastifyRequest): void {
  const raw = request.headers["x-reckon-tenant"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === "") return;
  if (value !== auth.tenantId) {
    throw new ApiError(
      ERROR_CODES.TENANT_MISMATCH,
      403,
      `X-Reckon-Tenant header '${value}' does not match the authenticated tenant '${auth.tenantId}'`,
      { authenticatedTenantId: auth.tenantId, headerTenantId: value },
    );
  }
}

/**
 * Security-first tenant peek on the RAW (pre-validation) body: if the body
 * carries a tenant object with a tenantId string, enforce the match BEFORE
 * deep validation so cross-tenant payloads are rejected without further
 * processing. Malformed tenant values are left to schema validation (400).
 */
export function peekBodyTenant(auth: AuthContext, body: unknown): void {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return;
  const tenant = (body as { tenant?: unknown }).tenant;
  if (tenant === null || typeof tenant !== "object" || Array.isArray(tenant)) return;
  const { tenantId, workspaceId } = tenant as { tenantId?: unknown; workspaceId?: unknown };
  if (typeof tenantId !== "string") return;
  const scope: TenantScope =
    typeof workspaceId === "string" ? { tenantId, workspaceId } : { tenantId };
  assertRequestTenant(auth, scope);
}
