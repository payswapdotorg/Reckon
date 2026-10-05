/**
 * Dashboard test/live mode — the pure state machine behind the
 * account-level toggle (S3-001; the Stripe dashboard's signature
 * affordance).
 *
 * The machine is deliberately React-free so the whole behavior is unit
 * tested without a renderer (test/mode-machine.test.ts):
 *
 *  - mode is the account's current dashboard mode, using the frozen
 *    `KeyMode` vocabulary from @reckon/contracts ("test" | "live");
 *  - switching test → live REQUIRES an explicit confirmation (you are
 *    about to operate on live data);
 *  - switching live → test is immediate (the safe direction);
 *  - a destructive action requested in TEST mode is armed immediately
 *    (test mode never gates — that is its purpose);
 *  - the SAME destructive action requested in LIVE mode is held pending
 *    until an explicit confirmation, then armed exactly once;
 *  - confirmation state holds exactly one pending item at a time — a new
 *    request replaces whatever was pending, and declining clears it.
 *
 * HONEST PLACEHOLDER (work order S3-001): persistence is local-only and
 * request routing does not change yet — the API-side test-mode semantics
 * land with S2-003 in parallel. The provider (shell/mode-provider.tsx)
 * documents that in the toggle's own UI; the machine itself is complete.
 */

/** Reuse the frozen contracts vocabulary (sk_test_/sk_live_ key model). */
import type { KeyMode } from "@reckon/contracts";

export type DashboardMode = KeyMode;

export const DASHBOARD_MODES: readonly DashboardMode[] = ["test", "live"];

/** Default mode — a fresh dashboard starts in test, the safe mode. */
export const DEFAULT_DASHBOARD_MODE: DashboardMode = "test";

export function isDashboardMode(value: unknown): value is DashboardMode {
  return value === "test" || value === "live";
}

/**
 * A destructive dashboard action — anything whose live-mode consequences
 * are real (revoking a live key, deleting live data…). The id is stable
 * ("revoke-api-key"); the context carries the target ("sk_live_…a1b2").
 */
export interface DestructiveAction {
  readonly id: string;
  /** Human label for the confirm dialog, e.g. "Revoke API key". */
  readonly label: string;
  /** What the action targets, shown in the confirm dialog. */
  readonly context?: string;
}

export type ModeMachineAction =
  /** The user asked to switch the account mode (clicked the toggle). */
  | { readonly type: "SWITCH_REQUESTED"; readonly to: DashboardMode }
  /** The open confirm dialog was accepted. */
  | { readonly type: "CONFIRM_ACCEPTED" }
  /** The open confirm dialog was declined / dismissed. */
  | { readonly type: "CONFIRM_DECLINED" }
  /** A destructive action was requested (may or may not need confirmation). */
  | { readonly type: "DESTRUCTIVE_REQUESTED"; readonly action: DestructiveAction }
  /** The consumer finished executing an armed destructive action. */
  | { readonly type: "DESTRUCTIVE_COMPLETED" }
  /** Restored mode from persistence (mount-time hydration). */
  | { readonly type: "HYDRATED"; readonly mode: DashboardMode };

export interface ModeMachineState {
  /** The account's current dashboard mode. */
  readonly mode: DashboardMode;
  /** Mode switch awaiting confirmation (switching INTO live), or null. */
  readonly pendingSwitchTo: DashboardMode | null;
  /** Destructive action awaiting live-mode confirmation, or null. */
  readonly pendingDestructive: DestructiveAction | null;
  /**
   * A confirmed destructive action the consumer must now execute exactly
   * once — cleared again by DESTRUCTIVE_COMPLETED. The machine hands the
   * action over; it never executes anything itself.
   */
  readonly armedDestructive: DestructiveAction | null;
}

export const INITIAL_MODE_STATE: ModeMachineState = {
  mode: DEFAULT_DASHBOARD_MODE,
  pendingSwitchTo: null,
  pendingDestructive: null,
  armedDestructive: null,
};

/** Switching into live mode is the direction that requires confirmation. */
export function switchRequiresConfirmation(from: DashboardMode, to: DashboardMode): boolean {
  return from === "test" && to === "live";
}

/** Destructive actions are gated by a confirmation only in live mode. */
export function destructiveRequiresConfirmation(mode: DashboardMode): boolean {
  return mode === "live";
}

/** A confirm dialog of either kind is open. */
export function hasPendingConfirmation(state: ModeMachineState): boolean {
  return state.pendingSwitchTo !== null || state.pendingDestructive !== null;
}

/**
 * The pure transition. Unknown/no-op inputs return the SAME state object
 * (referential stability — safe for React dependency arrays).
 */
export function nextModeState(state: ModeMachineState, action: ModeMachineAction): ModeMachineState {
  switch (action.type) {
    case "SWITCH_REQUESTED": {
      if (action.to === state.mode) {
        return state;
      }
      if (switchRequiresConfirmation(state.mode, action.to)) {
        // test → live: hold for confirmation; replace any pending dialog.
        return { ...state, pendingSwitchTo: action.to, pendingDestructive: null };
      }
      // live → test (or any safe direction): immediate, clears dialogs.
      return {
        mode: action.to,
        pendingSwitchTo: null,
        pendingDestructive: null,
        armedDestructive: null,
      };
    }

    case "DESTRUCTIVE_REQUESTED": {
      if (!destructiveRequiresConfirmation(state.mode)) {
        // Test mode never gates: arm immediately. Any dialog already
        // pending is replaced (one pending item at a time, last wins).
        return { ...state, pendingSwitchTo: null, pendingDestructive: null, armedDestructive: action.action };
      }
      // Live mode: hold for confirmation; replace any pending dialog.
      return { ...state, pendingSwitchTo: null, pendingDestructive: action.action };
    }

    case "CONFIRM_ACCEPTED": {
      if (state.pendingSwitchTo !== null) {
        return {
          mode: state.pendingSwitchTo,
          pendingSwitchTo: null,
          pendingDestructive: null,
          armedDestructive: null,
        };
      }
      if (state.pendingDestructive !== null) {
        return {
          ...state,
          pendingSwitchTo: null,
          pendingDestructive: null,
          armedDestructive: state.pendingDestructive,
        };
      }
      return state;
    }

    case "CONFIRM_DECLINED": {
      if (state.pendingSwitchTo === null && state.pendingDestructive === null) {
        return state;
      }
      return { ...state, pendingSwitchTo: null, pendingDestructive: null };
    }

    case "DESTRUCTIVE_COMPLETED": {
      if (state.armedDestructive === null) {
        return state;
      }
      return { ...state, armedDestructive: null };
    }

    case "HYDRATED": {
      if (action.mode === state.mode || hasPendingConfirmation(state)) {
        return state;
      }
      // Hydration only ever restores the persisted mode; it never clears
      // an interaction already in flight.
      return { ...state, mode: action.mode };
    }

    default: {
      // Exhaustiveness guard: a new action type must be handled above.
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

/** localStorage key the provider persists the mode under. */
export const MODE_STORAGE_KEY = "reckon.studio.dashboard-mode";
