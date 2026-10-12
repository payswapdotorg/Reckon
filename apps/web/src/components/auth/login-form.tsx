/**
 * LoginForm — the login half of TL6-003. Client component: collects
 * credentials, posts to the studio's proxy (POST
 * /api/dashboard/account/login → the REAL POST /v1/account/login
 * attempt), and lands the sanitized `next` target on success.
 *
 * Honesty laws:
 *  - the API's typed 401 renders "invalid email or password" (the API
 *    deliberately never reveals which part failed — neither do we);
 *  - unreachable / not-wired / error outcomes render the observed detail
 *    verbatim — never a masked "something went wrong";
 *  - client validation is a UX pre-flight only; the frozen contracts are
 *    the authority (their issues surface verbatim when a request
 *    nonetheless fails validation).
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CircleAlert, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  LOGIN_BOUNDS,
  authFailureView,
  loginValid,
  safeNextPath,
  validateLogin,
  type LoginNotice,
} from "@/lib/auth-view";
import styles from "./auth-form.module.css";

export interface LoginFormProps {
  /** Sanitized post-login target (already passed through safeNextPath server-side). */
  readonly nextPath: string;
  /** The honest reason the user landed on /login (expired session, …), or null. */
  readonly notice: LoginNotice | null;
  /** Optional email prefill (e.g. forwarded from a signup EMAIL_TAKEN). */
  readonly initialEmail: string;
}

interface ProxyFailureShape {
  readonly outcome?: unknown;
  readonly detail?: unknown;
  readonly code?: unknown;
}

export function LoginForm({ nextPath, notice, initialEmail }: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<{ title: string; detail: string; focusEmail: boolean; suggestLogin: boolean } | null>(null);

  const errors = validateLogin({ email, password });
  const emailInvalid = touched && errors.email !== null;
  const passwordInvalid = touched && errors.password !== null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!loginValid(errors)) return;
    setSubmitting(true);
    setFailure(null);
    try {
      const response = await fetch("/api/dashboard/account/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const body: unknown = await response.json();
      if (response.ok && typeof body === "object" && body !== null && (body as { ok?: unknown }).ok === true) {
        // The httpOnly session cookie is set by the proxy; revalidate the
        // server tree and land the sanitized target.
        router.push(nextPath);
        router.refresh();
        return;
      }
      setFailure(authFailureView(asProxyFailure(body)));
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      setFailure({
        title: "The studio's login proxy did not answer",
        detail: reason,
        focusEmail: false,
        suggestLogin: false,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      {notice !== null && failure === null ? (
        <div className={`${styles.notice} ${styles.noticeInfo}`} role="status">
          <Info aria-hidden="true" size={16} strokeWidth={1.75} className={styles.noticeIcon} />
          <span>
            <span className={styles.noticeTitle}>{notice.title}.</span>{" "}
            <span className={styles.noticeDetail}>{notice.detail}</span>
          </span>
        </div>
      ) : null}

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
                    Go to sign in
                  </Link>
                </>
              ) : null}
            </span>
          </span>
        </div>
      ) : null}

      <div className={styles.fields}>
        <label className={styles.fieldLabel} htmlFor="login-email">
          Email
        </label>
        <input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          className={emailInvalid ? `${styles.input} ${styles.inputInvalid}` : styles.input}
          value={email}
          maxLength={LOGIN_BOUNDS.emailMax}
          placeholder="you@company.com"
          aria-invalid={emailInvalid}
          aria-describedby={emailInvalid ? "login-email-error" : undefined}
          disabled={submitting}
          onChange={(event) => setEmail(event.target.value)}
        />
        {emailInvalid ? (
          <p id="login-email-error" className={styles.fieldError}>
            {errors.email}
          </p>
        ) : null}

        <label className={styles.fieldLabel} htmlFor="login-password">
          Password
        </label>
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          className={passwordInvalid ? `${styles.input} ${styles.inputInvalid}` : styles.input}
          value={password}
          maxLength={LOGIN_BOUNDS.passwordMax}
          placeholder="Your password"
          aria-invalid={passwordInvalid}
          aria-describedby={passwordInvalid ? "login-password-error" : undefined}
          disabled={submitting}
          onChange={(event) => setPassword(event.target.value)}
        />
        {passwordInvalid ? (
          <p id="login-password-error" className={styles.fieldError}>
            {errors.password}
          </p>
        ) : null}
      </div>

      <div className={`${styles.actions} ${styles.actionsSplit}`}>
        <span className={styles.altRow}>
          No account yet?{" "}
          <Link className={styles.altLink} href={`/signup?next=${encodeURIComponent(nextPath)}`}>
            Create one
          </Link>
        </span>
        <Button variant="primary" size="md" type="submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </div>
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
    detail: "The login proxy returned an unrecognized response — nothing was signed in.",
    code: null,
  };
}
