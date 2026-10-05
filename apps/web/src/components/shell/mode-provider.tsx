/**
 * DashboardModeProvider — the account-level test/live mode context
 * (S3-001). Wires the PURE mode machine (lib/mode-machine.ts) to the
 * shell:
 *
 *  - persistence: the mode round-trips through localStorage
 *    (reckon.studio.dashboard-mode). HONEST PLACEHOLDER: persistence is
 *    local to this browser — the API-side test-mode semantics (request
 *    routing, test-data separation) land with S2-003 in parallel;
 *  - recoloring: the current mode is mirrored onto
 *    `<html data-reckon-mode>` so every mode indicator in the shell can
 *    restyle itself without prop drilling;
 *  - gating: switching test→live and destructive actions in live mode
 *    both open the confirm dialogs rendered here.
 *
 * Client component (localStorage + dialogs). The server always renders
 * the DEFAULT_DASHBOARD_MODE; the persisted mode hydrates after mount —
 * the first client render matches the server, so there is no hydration
 * mismatch, only a post-mount visual settle.
 */
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_DASHBOARD_MODE,
  INITIAL_MODE_STATE,
  MODE_STORAGE_KEY,
  isDashboardMode,
  nextModeState,
  type DashboardMode,
  type DestructiveAction,
  type ModeMachineState,
} from "@/lib/mode-machine";
import styles from "./mode-dialogs.module.css";

export interface DashboardModeContextValue {
  readonly mode: DashboardMode;
  /** False during the first render (before localStorage hydration). */
  readonly mounted: boolean;
  readonly state: ModeMachineState;
  /** Ask to switch the account mode (may open the switch confirm dialog). */
  readonly requestModeSwitch: (to: DashboardMode) => void;
  /** Request a destructive action (gated by confirm only in live mode). */
  readonly requestDestructive: (action: DestructiveAction) => void;
  /** Accept the open confirmation. */
  readonly confirm: () => void;
  /** Decline/dismiss the open confirmation. */
  readonly decline: () => void;
  /** Report that an armed destructive action finished executing. */
  readonly completeDestructive: () => void;
}

const DashboardModeContext = createContext<DashboardModeContextValue | null>(null);

export function DashboardModeProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(nextModeState, INITIAL_MODE_STATE);
  const mountedRef = useRef(false);

  // Hydrate the persisted mode once, after mount (server default = test).
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(MODE_STORAGE_KEY);
      if (stored !== null && isDashboardMode(stored) && stored !== DEFAULT_DASHBOARD_MODE) {
        dispatch({ type: "HYDRATED", mode: stored });
      }
    } catch {
      // localStorage unavailable (private mode…) — stay on the default.
    }
    mountedRef.current = true;
  }, []);

  // Persist + recolor whenever the mode changes.
  useEffect(() => {
    document.documentElement.dataset.reckonMode = state.mode;
    try {
      window.localStorage.setItem(MODE_STORAGE_KEY, state.mode);
    } catch {
      // Persistence is best-effort by design (see header comment).
    }
  }, [state.mode]);

  const requestModeSwitch = useCallback((to: DashboardMode) => {
    dispatch({ type: "SWITCH_REQUESTED", to });
  }, []);
  const requestDestructive = useCallback((action: DestructiveAction) => {
    dispatch({ type: "DESTRUCTIVE_REQUESTED", action });
  }, []);
  const confirm = useCallback(() => dispatch({ type: "CONFIRM_ACCEPTED" }), []);
  const decline = useCallback(() => dispatch({ type: "CONFIRM_DECLINED" }), []);
  const completeDestructive = useCallback(() => dispatch({ type: "DESTRUCTIVE_COMPLETED" }), []);

  const value = useMemo<DashboardModeContextValue>(
    () => ({
      mode: state.mode,
      mounted: mountedRef.current,
      state,
      requestModeSwitch,
      requestDestructive,
      confirm,
      decline,
      completeDestructive,
    }),
    [state, requestModeSwitch, requestDestructive, confirm, decline, completeDestructive],
  );

  return (
    <DashboardModeContext.Provider value={value}>
      {children}
      <ModeConfirmDialogs />
    </DashboardModeContext.Provider>
  );
}

export function useDashboardMode(): DashboardModeContextValue {
  const context = useContext(DashboardModeContext);
  if (context === null) {
    throw new Error("useDashboardMode must be used inside <DashboardModeProvider>");
  }
  return context;
}

/* ================================================================== *
 * Confirm dialogs (switch-to-live + destructive-in-live)
 * ================================================================== */

const SWITCH_TO_LIVE_PLACEHOLDER_NOTE =
  "Mode switching is visual and local for now — API-side test-mode semantics (test-data separation and request routing) land with S2-003.";

function ModeConfirmDialogs() {
  const { state, confirm, decline } = useDashboardMode();

  if (state.pendingSwitchTo === "live") {
    return (
      <ModeDialog
        dialogId="reckon-mode-switch-dialog"
        title="Switch to live mode?"
        body={
          <p className={styles.dialogBody}>
            Live mode operates on <strong>real account data</strong> — requests made here hit live
            tenants, and destructive actions have real consequences. Every such action will ask for
            confirmation.
          </p>
        }
        note={SWITCH_TO_LIVE_PLACEHOLDER_NOTE}
        confirmLabel="Switch to live mode"
        cancelLabel="Stay in test mode"
        onConfirm={confirm}
        onCancel={decline}
      />
    );
  }

  if (state.pendingDestructive !== null) {
    const action = state.pendingDestructive;
    return (
      <ModeDialog
        dialogId="reckon-mode-destructive-dialog"
        title={`${action.label} in live mode`}
        body={
          <p className={styles.dialogBody}>
            You are about to {action.label.toLowerCase()} in <strong>live mode</strong>
            {action.context !== undefined ? (
              <>
                {" — "}
                <code className={styles.dialogCode}>{action.context}</code>
              </>
            ) : null}
            . This affects the live account and cannot be undone.
          </p>
        }
        confirmLabel={action.label}
        cancelLabel="Cancel"
        tone="destructive"
        onConfirm={confirm}
        onCancel={decline}
      />
    );
  }

  return null;
}

interface ModeDialogProps {
  readonly dialogId: string;
  readonly title: string;
  readonly body: ReactNode;
  readonly note?: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly tone?: "default" | "destructive";
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

function ModeDialog({
  dialogId,
  title,
  body,
  note,
  confirmLabel,
  cancelLabel,
  tone = "default",
  onConfirm,
  onCancel,
}: ModeDialogProps) {
  // Escape declines (the safe direction), like the nav drawer.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCancel();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div
      className={styles.overlay}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        id={dialogId}
        className={styles.dialog}
      >
        <div className={styles.dialogHead}>
          <ShieldAlert
            className={tone === "destructive" ? styles.dialogIconDestructive : styles.dialogIcon}
            aria-hidden="true"
            strokeWidth={1.75}
            size={22}
          />
          <h2 className={styles.dialogTitle}>{title}</h2>
        </div>
        {body}
        {note !== undefined ? <p className={styles.dialogNote}>{note}</p> : null}
        <div className={styles.dialogActions}>
          <Button variant="secondary" size="md" onClick={onCancel} autoFocus>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "destructive" ? "primary" : "primary"}
            size="md"
            className={tone === "destructive" ? styles.confirmDestructive : undefined}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
