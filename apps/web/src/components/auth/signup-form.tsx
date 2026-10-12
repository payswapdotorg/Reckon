/**
 * SignupForm — the progressive signup flow (TL6-003): step 1 collects the
 * account basics (name, email, password + confirmation); step 2 names
 * the workspace (prefilled from the founder's name, editable). One
 * submit creates the account through the studio's proxy (POST
 * /api/dashboard/account/signup → the REAL POST /v1/account/signup),
 * which parks the first reckonsess_ session in the httpOnly cookie — the
 * user is signed in immediately, no second step required.
 *
 * Progressive continuation: on success the flow lands the sanitized
 * `next` target, defaulting to /developers/keys?welcome=1 — the product
 * UX's next action (create your first API key, then make the call).
 *
 * Honesty laws: EMAIL_TAKEN renders as a field error with a sign-in
 * offer; unreachable / not-wired / error outcomes render the observed
 * detail verbatim; the client-side bounds mirror the frozen contracts
 * (the API's own zod issues surface verbatim when they disagree).
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CircleAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  SIGNUP_BOUNDS,
  SIGNUP_STEPS,
  authFailureView,
  defaultWorkspaceName,
  signupStep1Valid,
  validateSignupStep1,
  validateWorkspaceName,
  type SignupStep,
} from "@/lib/auth-view";
import styles from "./auth-form.module.css";

export interface SignupFormProps {
  /** Sanitized post-signup target (already passed through safeNextPath server-side). */
  readonly nextPath: string;
  /** Optional email prefill. */
  readonly initialEmail: string;
}

interface ProxyFailureShape {
  readonly outcome?: unknown;
  readonly detail?: unknown;
  readonly code?: unknown;
}

/** The product-UX continuation after a fresh signup: create the first key. */
const DEFAULT_SIGNUP_NEXT_PATH = "/developers/keys?welcome=1";

export function SignupForm({ nextPath, initialEmail }: SignupFormProps) {
  const router = useRouter();
  const [step, setStep] = useState<SignupStep>(1);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<{ title: string; detail: string; focusEmail: boolean; suggestLogin: boolean } | null>(null);

  const step1Errors = validateSignupStep1({ fullName, email, password, confirmPassword });
  const workspaceError = validateWorkspaceName(workspaceName);

  function toStep2() {
    setTouched(true);
    if (signupStep1Valid(step1Errors)) {
      // Progressive prefill: the workspace is named after its founder.
      setWorkspaceName((current) => (current.trim().length === 0 ? defaultWorkspaceName(fullName) : current));
      setStep(2);
      setFailure(null);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!signupStep1Valid(step1Errors) || validateWorkspaceName(workspaceName) !== null) {
      setStep(1);
      return;
    }
    setSubmitting(true);
    setFailure(null);
    try {
      const response = await fetch("/api/dashboard/account/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          fullName: fullName.trim(),
          workspaceName: workspaceName.trim(),
        }),
      });
      const body: unknown = await response.json();
      if (response.ok && typeof body === "object" && body !== null && (body as { ok?: unknown }).ok === true) {
        // Signed in via the httpOnly cookie; land the progressive target.
        const target = nextPath === "/" ? DEFAULT_SIGNUP_NEXT_PATH : nextPath;
        router.push(target);
        router.refresh();
        return;
      }
      setFailure(authFailureView(asProxyFailure(body)));
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      setFailure({
        title: "The studio's signup proxy did not answer",
        detail: reason,
        focusEmail: false,
        suggestLogin: false,
      });
    } finally {
      setSubmitting(false);
    }
  }

  const nameInvalid = touched && step1Errors.fullName !== null;
  const emailInvalid = touched && step1Errors.email !== null;
  const passwordInvalid = touched && step1Errors.password !== null;
  const confirmInvalid = touched && step1Errors.confirmPassword !== null;
  const workspaceInvalid = step === 2 && touched && workspaceError !== null;

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <div className={styles.stepHeader}>
        <div className={styles.stepTrail} aria-label={`Signup step ${step} of 2`}>
          {SIGNUP_STEPS.map((entry, index) => (
            <span key={entry.step} className={styles.stepTrailParts}>
              {index > 0 ? <span className={styles.stepSeparator} aria-hidden="true">·</span> : null}
              <span className={entry.step === step ? styles.stepTrailCurrent : undefined} aria-current={entry.step === step ? "step" : undefined}>
                {entry.step}. {entry.label}
              </span>
            </span>
          ))}
        </div>
      </div>

      {failure !== null ? (
        <div className={`${styles.notice} ${styles.noticeWarn}`} role="alert">
          <CircleAlert aria-hidden="true" size={16} strokeWidth={1.75} className={styles.noticeIcon} />
          <span>
            <span className={styles.noticeTitle}>{failure.title}.</span>{" "}
            <span className={styles.noticeDetail}>
              {failure.detail}
              {failure.suggestLogin ? (
                <>
                  {" "}
                  <Link href={`/login?email=${encodeURIComponent(email.trim())}&next=${encodeURIComponent(nextPath)}`} className={styles.noticeAction}>
                    Sign in instead
                  </Link>
                </>
              ) : null}
            </span>
          </span>
        </div>
      ) : null}

      {step === 1 ? (
        <div className={styles.fields}>
          <label className={styles.fieldLabel} htmlFor="signup-name">
            Your name
          </label>
          <input
            id="signup-name"
            name="fullName"
            autoComplete="name"
            className={nameInvalid ? `${styles.input} ${styles.inputInvalid}` : styles.input}
            value={fullName}
            maxLength={SIGNUP_BOUNDS.fullNameMax}
            placeholder="Ada Founder"
            aria-invalid={nameInvalid}
            aria-describedby={nameInvalid ? "signup-name-error" : undefined}
            onChange={(event) => setFullName(event.target.value)}
          />
          {nameInvalid ? (
            <p id="signup-name-error" className={styles.fieldError}>
              {step1Errors.fullName}
            </p>
          ) : null}

          <label className={styles.fieldLabel} htmlFor="signup-email">
            Email
          </label>
          <input
            id="signup-email"
            name="email"
            type="email"
            autoComplete="email"
            className={emailInvalid ? `${styles.input} ${styles.inputInvalid}` : styles.input}
            value={email}
            maxLength={SIGNUP_BOUNDS.emailMax}
            placeholder="you@company.com"
            aria-invalid={emailInvalid}
            aria-describedby={emailInvalid ? "signup-email-error" : undefined}
            onChange={(event) => setEmail(event.target.value)}
          />
          {emailInvalid ? (
            <p id="signup-email-error" className={styles.fieldError}>
              {step1Errors.email}
            </p>
          ) : null}

          <label className={styles.fieldLabel} htmlFor="signup-password">
            Password
          </label>
          <input
            id="signup-password"
            name="password"
            type="password"
            autoComplete="new-password"
            className={passwordInvalid ? `${styles.input} ${styles.inputInvalid}` : styles.input}
            value={password}
            maxLength={SIGNUP_BOUNDS.passwordMax}
            placeholder="At least 8 characters"
            aria-invalid={passwordInvalid}
            aria-describedby={passwordInvalid ? "signup-password-error" : undefined}
            onChange={(event) => setPassword(event.target.value)}
          />
          {passwordInvalid ? (
            <p id="signup-password-error" className={styles.fieldError}>
              {step1Errors.password}
            </p>
          ) : null}

          <label className={styles.fieldLabel} htmlFor="signup-confirm">
            Confirm password
          </label>
          <input
            id="signup-confirm"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            className={confirmInvalid ? `${styles.input} ${styles.inputInvalid}` : styles.input}
            value={confirmPassword}
            maxLength={SIGNUP_BOUNDS.passwordMax}
            placeholder="Repeat your password"
            aria-invalid={confirmInvalid}
            aria-describedby={confirmInvalid ? "signup-confirm-error" : undefined}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
          {confirmInvalid ? (
            <p id="signup-confirm-error" className={styles.fieldError}>
              {step1Errors.confirmPassword}
            </p>
          ) : null}
        </div>
      ) : (
        <div className={styles.fields}>
          <label className={styles.fieldLabel} htmlFor="signup-workspace">
            Workspace name
          </label>
          <input
            id="signup-workspace"
            name="workspaceName"
            className={workspaceInvalid ? `${styles.input} ${styles.inputInvalid}` : styles.input}
            value={workspaceName}
            maxLength={SIGNUP_BOUNDS.workspaceNameMax}
            placeholder="Your workspace"
            aria-invalid={workspaceInvalid}
            aria-describedby={workspaceInvalid ? "signup-workspace-error" : undefined}
            onChange={(event) => setWorkspaceName(event.target.value)}
          />
          {workspaceInvalid ? (
            <p id="signup-workspace-error" className={styles.fieldError}>
              {workspaceError}
            </p>
          ) : (
            <p className={styles.fieldHint}>
              The workspace names this account&apos;s tenant. It can be renamed later — nothing else depends on it now.
            </p>
          )}
          <p className={styles.trustRow}>
            <ShieldCheck aria-hidden="true" size={14} strokeWidth={1.75} className={styles.trustIcon} />
            Passwords are hashed with scrypt on the API; the session token goes straight into an httpOnly cookie — this browser never renders it.
          </p>
        </div>
      )}

      {step === 1 ? (
        <div className={`${styles.actions} ${styles.actionsSplit}`}>
          <span className={styles.altRow}>
            Already have an account?{" "}
            <Link className={styles.altLink} href={`/login?next=${encodeURIComponent(nextPath)}`}>
              Sign in
            </Link>
          </span>
          <Button variant="primary" size="md" type="button" onClick={toStep2}>
            Continue
          </Button>
        </div>
      ) : (
        <div className={`${styles.actions} ${styles.actionsSplit}`}>
          <Button variant="secondary" size="md" type="button" onClick={() => setStep(1)} disabled={submitting}>
            Back
          </Button>
          <Button variant="primary" size="md" type="submit" disabled={submitting}>
            {submitting ? "Creating account…" : "Create account"}
          </Button>
        </div>
      )}
    </form>
  );
}

function asProxyFailure(body: unknown): { outcome: "unauthenticated" | "unreachable" | "not-wired" | "error"; detail: string; code: string | null } {
  if (typeof body === "object" && body !== null) {
    const failure = (body as { failure?: ProxyFailureShape }).failure;
    if (typeof failure === "object" && failure !== null) {
      const outcome = failure.outcome;
      const detail = typeof failure.detail === "string" && failure.detail.length > 0 ? failure.detail : "The proxy returned an unrecognized failure.";
      const code = typeof failure.code === "string" ? failure.code : null;
      if (outcome === "unauthenticated" || outcome === "unreachable" || outcome === "not-wired" || outcome === "error") {
        return { outcome, detail, code };
      }
      return { outcome: "error", detail, code };
    }
  }
  return {
    outcome: "error",
    detail: "The signup proxy returned an unrecognized response — nothing was created.",
    code: null,
  };
}
