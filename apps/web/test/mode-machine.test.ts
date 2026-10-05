/**
 * Dashboard mode machine tests (S3-001) — the complete UI state machine
 * for the test/live toggle: test↔live transitions, the switch-to-live
 * confirmation, live-mode destructive gating, hydration and the
 * one-pending-at-a-time rule. Pure logic, no React.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DASHBOARD_MODE,
  INITIAL_MODE_STATE,
  isDashboardMode,
  destructiveRequiresConfirmation,
  hasPendingConfirmation,
  nextModeState,
  switchRequiresConfirmation,
  type ModeMachineState,
} from "../src/lib/mode-machine.js";

function live(): ModeMachineState {
  return { mode: "live", pendingSwitchTo: null, pendingDestructive: null, armedDestructive: null };
}

describe("mode vocabulary + guards", () => {
  it("defaults to test mode (the safe mode) with nothing pending", () => {
    expect(DEFAULT_DASHBOARD_MODE).toBe("test");
    expect(INITIAL_MODE_STATE).toEqual({
      mode: "test",
      pendingSwitchTo: null,
      pendingDestructive: null,
      armedDestructive: null,
    });
  });

  it("isDashboardMode accepts exactly live/test", () => {
    expect(isDashboardMode("test")).toBe(true);
    expect(isDashboardMode("live")).toBe(true);
    expect(isDashboardMode("TEST")).toBe(false);
    expect(isDashboardMode(undefined)).toBe(false);
    expect(isDashboardMode(42)).toBe(false);
  });

  it("switching INTO live requires confirmation; every other direction is free", () => {
    expect(switchRequiresConfirmation("test", "live")).toBe(true);
    expect(switchRequiresConfirmation("live", "test")).toBe(false);
    expect(switchRequiresConfirmation("test", "test")).toBe(false);
    expect(switchRequiresConfirmation("live", "live")).toBe(false);
  });

  it("destructive actions are confirm-gated ONLY in live mode", () => {
    expect(destructiveRequiresConfirmation("live")).toBe(true);
    expect(destructiveRequiresConfirmation("test")).toBe(false);
  });
});

describe("test ↔ live transitions", () => {
  it("live → test switches immediately (the safe direction)", () => {
    const next = nextModeState(live(), { type: "SWITCH_REQUESTED", to: "test" });
    expect(next.mode).toBe("test");
    expect(next.pendingSwitchTo).toBeNull();
    expect(next.pendingDestructive).toBeNull();
  });

  it("test → live is HELD for confirmation, not applied", () => {
    const next = nextModeState(INITIAL_MODE_STATE, { type: "SWITCH_REQUESTED", to: "live" });
    expect(next.mode).toBe("test");
    expect(next.pendingSwitchTo).toBe("live");
    expect(hasPendingConfirmation(next)).toBe(true);
  });

  it("confirming the switch applies live mode and clears the dialog", () => {
    const pending = nextModeState(INITIAL_MODE_STATE, { type: "SWITCH_REQUESTED", to: "live" });
    const next = nextModeState(pending, { type: "CONFIRM_ACCEPTED" });
    expect(next.mode).toBe("live");
    expect(next.pendingSwitchTo).toBeNull();
    expect(hasPendingConfirmation(next)).toBe(false);
  });

  it("declining the switch keeps test mode", () => {
    const pending = nextModeState(INITIAL_MODE_STATE, { type: "SWITCH_REQUESTED", to: "live" });
    const next = nextModeState(pending, { type: "CONFIRM_DECLINED" });
    expect(next.mode).toBe("test");
    expect(next.pendingSwitchTo).toBeNull();
  });

  it("requesting the CURRENT mode is a no-op (same reference)", () => {
    const idleTest = INITIAL_MODE_STATE;
    const idleLive = live();
    expect(nextModeState(idleTest, { type: "SWITCH_REQUESTED", to: "test" })).toBe(idleTest);
    expect(nextModeState(idleLive, { type: "SWITCH_REQUESTED", to: "live" })).toBe(idleLive);
  });

  it("a switch to test clears any armed/pending destructive state", () => {
    const armed: ModeMachineState = {
      mode: "live",
      pendingSwitchTo: null,
      pendingDestructive: null,
      armedDestructive: { id: "revoke-api-key", label: "Revoke API key" },
    };
    const next = nextModeState(armed, { type: "SWITCH_REQUESTED", to: "test" });
    expect(next.mode).toBe("test");
    expect(next.armedDestructive).toBeNull();
  });
});

describe("destructive-action gating (the live-mode confirm)", () => {
  const action = { id: "revoke-api-key", label: "Revoke API key", context: "sk_live_…9f2K" };

  it("in TEST mode the action arms immediately — no dialog", () => {
    const next = nextModeState(INITIAL_MODE_STATE, { type: "DESTRUCTIVE_REQUESTED", action });
    expect(next.armedDestructive).toEqual(action);
    expect(next.pendingDestructive).toBeNull();
    expect(hasPendingConfirmation(next)).toBe(false);
  });

  it("in LIVE mode the action is HELD for confirmation", () => {
    const next = nextModeState(live(), { type: "DESTRUCTIVE_REQUESTED", action });
    expect(next.armedDestructive).toBeNull();
    expect(next.pendingDestructive).toEqual(action);
    expect(hasPendingConfirmation(next)).toBe(true);
  });

  it("confirming in live mode arms the action exactly once", () => {
    const pending = nextModeState(live(), { type: "DESTRUCTIVE_REQUESTED", action });
    const armed = nextModeState(pending, { type: "CONFIRM_ACCEPTED" });
    expect(armed.armedDestructive).toEqual(action);
    expect(armed.pendingDestructive).toBeNull();

    // The consumer completes it → cleared again.
    const done = nextModeState(armed, { type: "DESTRUCTIVE_COMPLETED" });
    expect(done.armedDestructive).toBeNull();
  });

  it("declining in live mode never arms the action", () => {
    const pending = nextModeState(live(), { type: "DESTRUCTIVE_REQUESTED", action });
    const next = nextModeState(pending, { type: "CONFIRM_DECLINED" });
    expect(next.armedDestructive).toBeNull();
    expect(next.pendingDestructive).toBeNull();
  });

  it("DESTRUCTIVE_COMPLETED on an idle state is a no-op", () => {
    expect(nextModeState(INITIAL_MODE_STATE, { type: "DESTRUCTIVE_COMPLETED" })).toBe(INITIAL_MODE_STATE);
  });
});

describe("one pending dialog at a time (last request wins)", () => {
  it("a destructive request replaces a pending switch dialog", () => {
    const pendingSwitch = nextModeState(INITIAL_MODE_STATE, { type: "SWITCH_REQUESTED", to: "live" });
    const next = nextModeState(pendingSwitch, {
      type: "DESTRUCTIVE_REQUESTED",
      action: { id: "x", label: "X" },
    });
    // Still in test mode → armed immediately AND the switch dialog is gone.
    expect(next.mode).toBe("test");
    expect(next.pendingSwitchTo).toBeNull();
    expect(next.pendingDestructive).toBeNull();
    expect(next.armedDestructive?.id).toBe("x");
  });

  it("a switch request replaces a pending destructive dialog", () => {
    const pendingDestructive = nextModeState(live(), {
      type: "DESTRUCTIVE_REQUESTED",
      action: { id: "x", label: "X" },
    });
    const next = nextModeState(pendingDestructive, { type: "SWITCH_REQUESTED", to: "test" });
    // live→test is immediate: dialog gone, mode switched.
    expect(next.mode).toBe("test");
    expect(next.pendingDestructive).toBeNull();
  });

  it("confirming with NOTHING pending is a no-op", () => {
    expect(nextModeState(INITIAL_MODE_STATE, { type: "CONFIRM_ACCEPTED" })).toBe(INITIAL_MODE_STATE);
    expect(nextModeState(INITIAL_MODE_STATE, { type: "CONFIRM_DECLINED" })).toBe(INITIAL_MODE_STATE);
  });
});

describe("hydration (persistence restore)", () => {
  it("restores a persisted live mode", () => {
    const next = nextModeState(INITIAL_MODE_STATE, { type: "HYDRATED", mode: "live" });
    expect(next.mode).toBe("live");
  });

  it("never interrupts an interaction already in flight", () => {
    const pending = nextModeState(INITIAL_MODE_STATE, { type: "SWITCH_REQUESTED", to: "live" });
    const next = nextModeState(pending, { type: "HYDRATED", mode: "test" });
    // Hydration may not clear the pending switch (and same-mode is a no-op anyway).
    expect(next).toBe(pending);
  });

  it("same-mode hydration is a no-op", () => {
    expect(nextModeState(INITIAL_MODE_STATE, { type: "HYDRATED", mode: "test" })).toBe(INITIAL_MODE_STATE);
  });
});
