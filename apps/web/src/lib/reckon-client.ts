/**
 * Reckon Studio → Reckon API integration seam (UI-001).
 *
 * THE ONLY integration surface this app may consume: a configured
 * `createReckonClient` from `@reckon/sdk` (which itself re-exports the
 * frozen `@reckon/contracts` types). Never a database, never domain
 * internals (FINAL TL HANDOFF §29).
 *
 * SECRET LAW: this module is `server-only`. `RECKON_API_BASE_URL` and
 * `RECKON_DEMO_API_KEY` resolve exclusively in server components / route
 * handlers (server env), so no secret can reach a client bundle. The
 * display helpers below deliberately expose only non-secrets: the API
 * origin, booleans and labels. If a value ever needs to be public it must
 * arrive via an explicitly non-secret `NEXT_PUBLIC_RECKON_DEMO_*` name —
 * none exist today.
 *
 * Env (documented in apps/web/README.md):
 *   RECKON_API_BASE_URL  — API origin the studio points at
 *                          (default http://127.0.0.1:8080).
 *   RECKON_DEMO_API_KEY  — bearer key for the demo tenant (secret).
 *   RECKON_ENV           — honest environment label for the ENV badge
 *                          (defaults from NODE_ENV: "local"/"production").
 */
import "server-only";
import { createReckonClient, type ReckonClient } from "@reckon/sdk";

export const DEFAULT_RECKON_API_BASE_URL = "http://127.0.0.1:8080";

/** Non-secret, display-safe view of the studio's API configuration. */
export interface ReckonApiDisplayConfig {
  readonly baseUrl: string;
  readonly apiHostLabel: string;
  readonly demoApiKeyConfigured: boolean;
  readonly envLabel: string;
}

/** Thrown by {@link getReckonClient} when the demo key is not configured. */
export class ReckonClientNotConfiguredError extends Error {
  constructor() {
    super(
      "RECKON_DEMO_API_KEY is not set — the Reckon Studio cannot build a server-side SDK client. " +
        "Configure it in the server environment (never in a client bundle).",
    );
    this.name = "ReckonClientNotConfiguredError";
  }
}

function baseUrlFromEnv(): string {
  const raw = process.env.RECKON_API_BASE_URL?.trim();
  return raw && raw.length > 0 ? raw : DEFAULT_RECKON_API_BASE_URL;
}

function hostLabel(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/**
 * Display-safe configuration for status surfaces. Safe to pass as props to
 * any component: it carries no secret material.
 */
export function getReckonApiDisplayConfig(): ReckonApiDisplayConfig {
  const baseUrl = baseUrlFromEnv();
  const envLabel =
    process.env.RECKON_ENV?.trim() ||
    (process.env.NODE_ENV === "production" ? "production" : "local");
  return {
    baseUrl,
    apiHostLabel: hostLabel(baseUrl),
    demoApiKeyConfigured: Boolean(process.env.RECKON_DEMO_API_KEY?.trim()),
    envLabel,
  };
}

/**
 * The configured SDK client — the seam every UI-003+ workspace uses to
 * load real data. Server-side only; throws {@link ReckonClientNotConfiguredError}
 * when the demo key is absent so callers can degrade honestly (Gate Q).
 */
export function getReckonClient(): ReckonClient {
  const apiKey = process.env.RECKON_DEMO_API_KEY?.trim();
  if (!apiKey) {
    throw new ReckonClientNotConfiguredError();
  }
  return createReckonClient({
    baseUrl: baseUrlFromEnv(),
    apiKey,
  });
}
