/**
 * API-keys view models + flows (TL6-003, rewired to the account API) —
 * PURE logic, unit-tested in test/api-keys-view.test.ts.
 *
 * The wire shape changed with the account lane (TL6-001): an account key
 * is { keyId, kind, mode, tier, createdAt, lastUsedAt, revokedAt } —
 * epoch-ms timestamps, NO name, NO prefix (the list NEVER carries key
 * material). This module renders exactly that.
 *
 * Two laws live here (unchanged from S3-001, re-proven for the account lane):
 *
 *  1. THE ONCE-ONLY SECRET (the Stripe pattern). A minted key's RAW
 *     value exists in exactly ONE state of the mint flow (`created`).
 *     Acknowledging ("I've stored it") moves the flow to `stored`, which
 *     carries ONLY the non-secret metadata — not even a prefix fragment
 *     of the secret survives. There is NO transition back into
 *     `created`; closing the dialog from `created` discards the secret.
 *
 *  2. HONEST DEGRADATION (Gate Q). The flow's `failed` state carries the
 *     observed account-surface failure verbatim (unauthenticated /
 *     unreachable / not-wired / error) — including the pending API
 *     route — and never fabricates a key, a secret, or a success.
 */

import type { AccountKey, AccountKeyCreated } from "@reckon/contracts";
import type { AccountSurfaceFailure } from "./account-api.js";

/* ================================================================== *
 * Key row view model (the account-lane wire shape)
 * ================================================================== */

/** The sk_/pk_ + test/live vocabulary a key's kind+mode spell (presentation of KNOWN fields — never secret material). */
export type TokenVocabulary = "sk_test" | "sk_live" | "pk_test" | "pk_live";

export function tokenVocabulary(kind: "secret" | "publishable", mode: "live" | "test"): TokenVocabulary {
  const prefix = kind === "secret" ? "sk" : "pk";
  return `${prefix}_${mode}` as TokenVocabulary;
}

export interface ApiKeyRowView {
  /** The key's id (key_…). */
  readonly id: string;
  readonly kind: "secret" | "publishable";
  readonly mode: "live" | "test";
  readonly tier: "free" | "pro" | "enterprise";
  /** The vocabulary chip (sk_test …) — derived from kind+mode, not from secret material. */
  readonly token: TokenVocabulary;
  readonly kindLabel: "Secret key" | "Publishable key";
  /** "Not used yet" when the API reports null — explicit, never blank. */
  readonly lastUsedLabel: string;
  readonly createdLabel: string;
  readonly revoked: boolean;
  readonly revokedLabel: string | null;
  /** True when the key's mode matches the dashboard's current mode. */
  readonly matchesMode: boolean;
}

export function accountKeyRowView(
  record: AccountKey,
  currentMode: "live" | "test",
  formatTime: (ms: number) => string = (ms) => new Date(ms).toISOString(),
): ApiKeyRowView {
  return {
    id: record.keyId,
    kind: record.kind,
    mode: record.mode,
    tier: record.tier,
    token: tokenVocabulary(record.kind, record.mode),
    kindLabel: record.kind === "secret" ? "Secret key" : "Publishable key",
    lastUsedLabel: record.lastUsedAt === null ? "Not used yet" : formatTime(record.lastUsedAt),
    createdLabel: formatTime(record.createdAt),
    revoked: record.revokedAt !== null,
    revokedLabel: record.revokedAt === null ? null : `Revoked ${formatTime(record.revokedAt)}`,
    matchesMode: record.mode === currentMode,
  };
}

/**
 * The keys table lists current-mode keys first (Stripe's keys page is
 * mode-scoped), newest first, with revoked keys kept visible at the end
 * of their group (the API reports them with revokedAt set — the operator
 * sees the whole inventory honestly).
 */
export function accountKeyRowsView(
  records: readonly AccountKey[],
  currentMode: "live" | "test",
  formatTime?: (ms: number) => string,
): readonly ApiKeyRowView[] {
  const rows = records.map((record) => accountKeyRowView(record, currentMode, formatTime));
  return [...rows].sort((a, b) => {
    if (a.matchesMode !== b.matchesMode) return a.matchesMode ? -1 : 1;
    if (a.revoked !== b.revoked) return a.revoked ? 1 : -1;
    const recordA = records.find((record) => record.keyId === a.id);
    const recordB = records.find((record) => record.keyId === b.id);
    const createdA = recordA?.createdAt ?? 0;
    const createdB = recordB?.createdAt ?? 0;
    if (createdA !== createdB) return createdB - createdA;
    return a.id.localeCompare(b.id);
  });
}

/* ================================================================== *
 * Mint-key flow (the once-only secret machine — account lane)
 * ================================================================== */

/** The non-secret summary of a minted key (what survives acknowledgment). */
export interface MintedKeySummary {
  readonly keyId: string;
  readonly kind: "secret" | "publishable";
  readonly mode: "live" | "test";
  readonly tier: "free" | "pro" | "enterprise";
  readonly token: TokenVocabulary;
}

export type MintKeyFlowState =
  | { readonly phase: "closed" }
  | { readonly phase: "choosing" }
  | { readonly phase: "submitting"; readonly kind: "secret" | "publishable"; readonly mode: "live" | "test" }
  | { readonly phase: "created"; readonly key: AccountKeyCreated }
  | { readonly phase: "stored"; readonly summary: MintedKeySummary }
  | {
      readonly phase: "failed";
      readonly failure: AccountSurfaceFailure;
      readonly kind: "secret" | "publishable";
      readonly mode: "live" | "test";
    };

export type MintKeyFlowEvent =
  | { readonly type: "OPEN" }
  | { readonly type: "CLOSE" }
  | { readonly type: "SUBMIT"; readonly kind: "secret" | "publishable"; readonly mode: "live" | "test" }
  | {
      readonly type: "RESULT";
      readonly result: { ok: true; key: AccountKeyCreated } | { ok: false; failure: AccountSurfaceFailure };
    }
  | { readonly type: "SECRET_STORED" }
  | { readonly type: "RETRY" };

/**
 * The pure transition. Once-only invariants (asserted by tests):
 *  - `created` is reachable ONLY from `submitting` via RESULT ok;
 *  - leaving `created` (SECRET_STORED or CLOSE) drops the secret — the
 *    stored summary carries NO fragment of it (not even a prefix);
 *  - `stored`/`failed` can never transition into a state holding a secret.
 */
export function nextMintKeyFlowState(state: MintKeyFlowState, event: MintKeyFlowEvent): MintKeyFlowState {
  switch (event.type) {
    case "OPEN": {
      if (state.phase === "closed" || state.phase === "failed" || state.phase === "stored") {
        return { phase: "choosing" };
      }
      return state;
    }

    case "CLOSE": {
      // Closing ALWAYS discards any held secret (once-only law).
      return { phase: "closed" };
    }

    case "SUBMIT": {
      if (state.phase !== "choosing") {
        return state;
      }
      if (event.kind !== "secret" && event.kind !== "publishable") {
        return state;
      }
      if (event.mode !== "live" && event.mode !== "test") {
        return state;
      }
      return { phase: "submitting", kind: event.kind, mode: event.mode };
    }

    case "RESULT": {
      if (state.phase !== "submitting") {
        return state;
      }
      if (event.result.ok) {
        return { phase: "created", key: event.result.key };
      }
      return { phase: "failed", failure: event.result.failure, kind: state.kind, mode: state.mode };
    }

    case "SECRET_STORED": {
      if (state.phase !== "created") {
        return state;
      }
      // The secret is NOT carried over — metadata summary only (no fragment).
      return {
        phase: "stored",
        summary: {
          keyId: state.key.keyId,
          kind: state.key.kind,
          mode: state.key.mode,
          tier: state.key.tier,
          token: tokenVocabulary(state.key.kind, state.key.mode),
        },
      };
    }

    case "RETRY": {
      if (state.phase === "failed") {
        // Retry the same kind/mode without re-choosing.
        return { phase: "submitting", kind: state.kind, mode: state.mode };
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
 * The one place the RAW key may be read. `null` in every phase except
 * `created` — the machine's guarantee, one accessor.
 */
export function visibleMintedSecret(state: MintKeyFlowState): string | null {
  return state.phase === "created" ? state.key.key : null;
}

/* ================================================================== *
 * Revoke flow (live-mode confirm gating via the mode machine)
 * ================================================================== */

/** Stable destructive-action id for key revocation. */
export const REVOKE_API_KEY_ACTION_ID = "revoke-api-key";

export function revokeActionFor(record: AccountKey) {
  return {
    id: REVOKE_API_KEY_ACTION_ID,
    label: "Revoke API key",
    context: `${tokenVocabulary(record.kind, record.mode)} ${record.keyId}`,
  };
}

/**
 * The honest revoke outcome view: what the API actually said, in
 * operator language, with the route named when it is not wired.
 */
export function revokeOutcomeView(failure: AccountSurfaceFailure): { title: string; detail: string } {
  switch (failure.outcome) {
    case "unauthenticated":
      return {
        title: "Not revoked — the session is no longer valid",
        detail: failure.detail,
      };
    case "unreachable":
      return {
        title: "Not revoked — API unreachable",
        detail: failure.detail,
      };
    case "not-wired":
      return {
        title: "Not revoked — the account surface is not wired on this API",
        detail: failure.detail,
      };
    case "error":
      return {
        title: "Not revoked — the API rejected the request",
        detail: failure.detail,
      };
  }
}
