/**
 * API-keys view models + flows (S3-001) — PURE logic, unit-tested in
 * test/api-keys-view.test.ts.
 *
 * Two laws live here:
 *
 *  1. THE ONCE-ONLY SECRET (the Stripe pattern). A created key's full
 *     secret exists in exactly ONE state of the create flow (`created`).
 *     Acknowledging ("I've stored it") moves the flow to `stored`, which
 *     carries only the non-secret summary — there is NO transition back
 *     into `created`, so the secret can never be re-displayed. Closing
 *     the dialog from `created` also discards the secret.
 *
 *  2. HONEST DEGRADATION (Gate Q). The flow's `failed` state carries the
 *     observed surface failure verbatim (unconfigured / unreachable /
 *     not-wired / error) — including the pending API route — and never
 *     fabricates a key, a secret, or a success.
 */

import type { ApiKeyRecord, CreatedApiKey, SurfaceFailure } from "./developers-api.js";

/* ================================================================== *
 * Key row view model
 * ================================================================== */

export interface ApiKeyRowView {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly mode: "live" | "test";
  readonly kind: "secret" | "publishable";
  /** "Not used yet" when the API reports null — explicit, never blank. */
  readonly lastUsedLabel: string;
  readonly createdLabel: string;
  /** True when the key's mode matches the dashboard's current mode. */
  readonly matchesMode: boolean;
}

export function apiKeyRowView(
  record: ApiKeyRecord,
  currentMode: "live" | "test",
  formatTime: (iso: string) => string = (iso) => iso,
): ApiKeyRowView {
  return {
    id: record.id,
    name: record.name,
    prefix: record.prefix,
    mode: record.mode,
    kind: record.kind,
    lastUsedLabel: record.last_used_at === null ? "Not used yet" : formatTime(record.last_used_at),
    createdLabel: formatTime(record.created_at),
    matchesMode: record.mode === currentMode,
  };
}

/**
 * The keys table lists the keys for the dashboard's CURRENT mode first
 * (Stripe's keys page is mode-scoped), newest first, and marks the rest
 * as other-mode rows (kept visible so operators can see the whole key
 * inventory honestly).
 */
export function apiKeyRowsView(
  records: readonly ApiKeyRecord[],
  currentMode: "live" | "test",
  formatTime?: (iso: string) => string,
): readonly ApiKeyRowView[] {
  const rows = records.map((record) => apiKeyRowView(record, currentMode, formatTime));
  return [...rows].sort((a, b) => {
    if (a.matchesMode !== b.matchesMode) return a.matchesMode ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/* ================================================================== *
 * Create-key flow (the once-only secret machine)
 * ================================================================== */

export type CreateKeyFlowState =
  | { readonly phase: "closed" }
  | { readonly phase: "naming" }
  | { readonly phase: "submitting"; readonly name: string; readonly kind: "secret" | "publishable" }
  | { readonly phase: "created"; readonly key: CreatedApiKey }
  | { readonly phase: "stored"; readonly key: Omit<CreatedApiKey, "secret"> }
  | {
      readonly phase: "failed";
      readonly failure: SurfaceFailure;
      readonly name: string;
      readonly kind: "secret" | "publishable";
    };

export type CreateKeyFlowEvent =
  | { readonly type: "OPEN" }
  | { readonly type: "CLOSE" }
  | { readonly type: "SUBMIT"; readonly name: string; readonly kind: "secret" | "publishable" }
  | { readonly type: "RESULT"; readonly result: { ok: true; key: CreatedApiKey } | { ok: false; failure: SurfaceFailure } }
  | { readonly type: "SECRET_STORED" }
  | { readonly type: "RETRY" };

export const KEY_NAME_MAX_LENGTH = 64;

/** Key names: non-empty, trimmed, bounded. */
export function isValidKeyName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= KEY_NAME_MAX_LENGTH;
}

/**
 * The pure transition. Once-only invariants (asserted by tests):
 *  - `created` is reachable ONLY from `submitting` via RESULT ok;
 *  - leaving `created` (SECRET_STORED or CLOSE) drops the secret;
 *  - `stored`/`failed` can never transition into a state holding a secret.
 */
export function nextCreateKeyFlowState(state: CreateKeyFlowState, event: CreateKeyFlowEvent): CreateKeyFlowState {
  switch (event.type) {
    case "OPEN": {
      if (state.phase === "closed" || state.phase === "failed") {
        return { phase: "naming" };
      }
      return state;
    }

    case "CLOSE": {
      // Closing ALWAYS discards any held secret (once-only law).
      return { phase: "closed" };
    }

    case "SUBMIT": {
      if (state.phase !== "naming") {
        return state;
      }
      if (!isValidKeyName(event.name)) {
        return state;
      }
      return { phase: "submitting", name: event.name.trim(), kind: event.kind };
    }

    case "RESULT": {
      if (state.phase !== "submitting") {
        return state;
      }
      if (event.result.ok) {
        return { phase: "created", key: event.result.key };
      }
      return { phase: "failed", failure: event.result.failure, name: state.name, kind: state.kind };
    }

    case "SECRET_STORED": {
      if (state.phase !== "created") {
        return state;
      }
      // The secret is NOT carried over — summary only.
      const { secret: _secret, ...summary } = state.key;
      return { phase: "stored", key: summary };
    }

    case "RETRY": {
      if (state.phase === "failed") {
        // Retry the same name/kind without retyping.
        return { phase: "submitting", name: state.name, kind: state.kind };
      }
      return state;
    }

    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

/**
 * The one place the full secret may be read. `null` in every phase except
 * `created` — the machine's guarantee, one accessor.
 */
export function visibleSecret(state: CreateKeyFlowState): string | null {
  return state.phase === "created" ? state.key.secret : null;
}

/* ================================================================== *
 * Revoke flow (live-mode confirm gating via the mode machine)
 * ================================================================== */

/** Stable destructive-action id for key revocation. */
export const REVOKE_API_KEY_ACTION_ID = "revoke-api-key";

export function revokeActionFor(record: ApiKeyRecord) {
  return {
    id: REVOKE_API_KEY_ACTION_ID,
    label: "Revoke API key",
    context: `${record.prefix} (${record.name})`,
  };
}

/**
 * The honest revoke outcome view: what the API actually said, in
 * operator language, with the pending route named when not wired.
 */
export function revokeOutcomeView(failure: SurfaceFailure): { title: string; detail: string } {
  switch (failure.outcome) {
    case "unconfigured":
      return {
        title: "Not revoked — studio not configured",
        detail: failure.detail,
      };
    case "unreachable":
      return {
        title: "Not revoked — API unreachable",
        detail: failure.detail,
      };
    case "not-wired":
      return {
        title: "Not revoked — key management is not wired yet",
        detail: failure.detail,
      };
    case "error":
      return {
        title: "Not revoked — the API rejected the request",
        detail: failure.detail,
      };
  }
}
