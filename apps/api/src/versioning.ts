import {
  ApiVersionSchema,
  X_RECKON_VERSION_HEADER,
  type ApiVersionRegistry,
} from "@reckon/contracts";
import { ApiError, ERROR_CODES } from "./errors.js";
import { DEFAULT_API_VERSION } from "./config.js";

/**
 * API versioning (S2-001): every /v1 request negotiates its API version
 * through the `X-Reckon-Version` header against the version registry.
 *
 * - No header → the pinned default version (the one this composition
 *   ships: DEFAULT_API_VERSION, reported by /healthz).
 * - Header present → must be a REGISTERED, non-retired version, else a
 *   typed 400 invalid_request_error naming the header as `param`.
 * - The resolved version is echoed on every /v1 response as
 *   `X-Reckon-Version` and exposed to handlers via the request context.
 *
 * The registry is data, not code: new versions are ADDED here (status
 * "active" or "deprecated"), and the pinned default moves only with a
 * release. Behavior divergence between versions arrives when a second
 * behavior shape exists; the enforcement/echo machinery is the seam.
 */

/** The default registry: the current pinned version is the only registered one. */
export const DEFAULT_API_VERSION_REGISTRY: ApiVersionRegistry = Object.freeze([
  {
    version: DEFAULT_API_VERSION,
    status: "active",
    notes: "Pinned default. Initial Stripe-style hardening surface (S2-001).",
  },
]) satisfies ApiVersionRegistry;

export interface ResolvedApiVersion {
  readonly version: string;
  /** True when the request pinned it explicitly via the header. */
  readonly fromHeader: boolean;
}

/**
 * Resolve the request's API version. Throws a typed 400
 * invalid_request_error for unknown/malformed/retired versions.
 */
export function resolveRequestVersion(
  registry: ApiVersionRegistry,
  pinnedDefault: string,
  headerValue: string | undefined,
): ResolvedApiVersion {
  if (headerValue === undefined || headerValue === "") {
    return { version: pinnedDefault, fromHeader: false };
  }
  const parsedVersion = ApiVersionSchema.safeParse(headerValue);
  if (!parsedVersion.success) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_ERROR,
      400,
      `X-Reckon-Version header is not a valid API version (expected semver or YYYY-MM-DD): '${headerValue}'`,
      { supportedVersions: registry.map((entry) => entry.version) },
      "X-Reckon-Version",
    );
  }
  const entry = registry.find((candidate) => candidate.version === parsedVersion.data);
  if (entry === undefined) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_ERROR,
      400,
      `Unknown API version '${headerValue}' (registered versions: ${registry
        .map((candidate) => candidate.version)
        .join(", ")})`,
      { supportedVersions: registry.map((candidate) => candidate.version) },
      "X-Reckon-Version",
    );
  }
  if (entry.status === "retired") {
    throw new ApiError(
      ERROR_CODES.VALIDATION_ERROR,
      400,
      `API version '${entry.version}' is retired and no longer served`,
      { version: entry.version, ...(entry.retiresOn !== undefined ? { retiresOn: entry.retiresOn } : {}) },
      "X-Reckon-Version",
    );
  }
  return { version: entry.version, fromHeader: true };
}

/** Registry invariant (startup check): the pinned default must be registered and non-retired. */
export function assertRegistryCoherent(registry: ApiVersionRegistry, pinnedDefault: string): void {
  const entry = registry.find((candidate) => candidate.version === pinnedDefault);
  if (entry === undefined) {
    throw new ApiError(
      ERROR_CODES.INTERNAL,
      500,
      `API version registry incoherent: pinned default '${pinnedDefault}' is not registered`,
    );
  }
  if (entry.status === "retired") {
    throw new ApiError(
      ERROR_CODES.INTERNAL,
      500,
      `API version registry incoherent: pinned default '${pinnedDefault}' is retired`,
    );
  }
}

/**
 * Default-registry resolution (S2-001): a deployment may pin ANY version
 * (e.g. RECKON_API_VERSION, or a test label) without hand-building a
 * registry — the pinned default is auto-registered as active at the head
 * of the shipped registry. Strict coherence (pinned default MUST be an
 * explicit registry entry) is enforced only when the caller provides
 * their own registry via config.apiVersions.
 */
export function withRegisteredDefault(
  registry: ApiVersionRegistry,
  pinnedDefault: string,
): ApiVersionRegistry {
  if (registry.some((entry) => entry.version === pinnedDefault)) return registry;
  const parsed = ApiVersionSchema.safeParse(pinnedDefault);
  if (!parsed.success) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_ERROR,
      400,
      `Pinned default API version '${pinnedDefault}' is not a valid version string (semver or YYYY-MM-DD)`,
      undefined,
      "X-Reckon-Version",
    );
  }
  return [{ version: pinnedDefault, status: "active", notes: "Auto-registered pinned default." }, ...registry];
}
