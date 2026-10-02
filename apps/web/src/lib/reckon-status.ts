/**
 * Honest reachability probe for the Reckon API (server-only).
 *
 * The SDK surface (W3-002) is write/read-by-id only — it has no health or
 * list operation — so the studio probes the API's documented public
 * `GET /healthz` (apps/api README: unauthenticated, returns
 * `{ ok, version, contractsVersion }`) to report REAL connection state.
 *
 * Honesty law (reference §7 / Gate Q): this probe reports only what it
 * actually observed, including the precise failure reason. It never
 * fabricates reachability, versions, or data.
 */
import "server-only";

import { getReckonApiDisplayConfig } from "./reckon-client";

export interface ReckonApiProbe {
  readonly baseUrl: string;
  readonly reachable: boolean;
  /** What was actually observed — success detail or the precise failure reason. */
  readonly detail: string;
  readonly apiVersion: string | null;
  readonly contractsVersion: string | null;
  readonly checkedAt: string;
}

const PROBE_TIMEOUT_MS = 2000;

interface HealthzBody {
  ok?: unknown;
  version?: unknown;
  contractsVersion?: unknown;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function failureReason(cause: unknown): string {
  if (cause instanceof Error) {
    const underlying = (cause as { cause?: unknown }).cause;
    const underlyingMessage =
      underlying instanceof Error ? ` (${underlying.message})` : "";
    return `${cause.message}${underlyingMessage}`;
  }
  return String(cause);
}

/** Probe the configured Reckon API origin. Never throws. */
export async function probeReckonApi(): Promise<ReckonApiProbe> {
  const { baseUrl } = getReckonApiDisplayConfig();
  const checkedAt = new Date().toISOString();
  const base: Omit<ReckonApiProbe, "reachable" | "detail" | "apiVersion" | "contractsVersion"> = {
    baseUrl,
    checkedAt,
  };

  try {
    const response = await fetch(`${baseUrl}/healthz`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.toLowerCase().includes("application/json")) {
      return {
        ...base,
        reachable: false,
        detail: `GET /healthz answered ${response.status} ${response.statusText || ""}`.trim() +
          ` (content-type: ${contentType || "none"}) — not a healthy Reckon API`,
        apiVersion: null,
        contractsVersion: null,
      };
    }
    const body = (await response.json()) as HealthzBody;
    const apiVersion = asString(body.version);
    const contractsVersion = asString(body.contractsVersion);
    if (body.ok !== true) {
      return {
        ...base,
        reachable: false,
        detail: "GET /healthz returned 200 but ok !== true — the API reports itself unhealthy",
        apiVersion,
        contractsVersion,
      };
    }
    return {
      ...base,
      reachable: true,
      detail: `GET /healthz ok — api ${apiVersion ?? "unknown version"}, contracts ${
        contractsVersion ?? "unknown version"
      }`,
      apiVersion,
      contractsVersion,
    };
  } catch (cause) {
    return {
      ...base,
      reachable: false,
      detail: `GET /healthz failed — ${failureReason(cause)}`,
      apiVersion: null,
      contractsVersion: null,
    };
  }
}
