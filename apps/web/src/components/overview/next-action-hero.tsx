/**
 * NextActionHero — UI-003's primary surface (FINAL TL HANDOFF §8): the
 * "WHAT SHOULD HAPPEN NEXT?" answer card.
 *
 * HONESTY LAW (Gate Q): this card renders one of three things —
 *  1. a real answer, read live through the SDK seam
 *     (`GET /v1/decisions/{decisionId}`) and rendered verbatim
 *     (action, selected experience, policy, reported uncertainty/latency);
 *  2. the calm idle state, which states precisely why no answer is shown
 *     (the SDK surface has no "latest decision"/"active plan" read — a
 *     decision is read by id) and offers the by-id lookup;
 *  3. the degraded state (reference §7 language: red-tinted panel, precise
 *     reason, single Retry) when the lookup fails or the studio cannot
 *     reach the API / has no demo key.
 *
 * It NEVER fabricates an answer, a confidence, or a latency, and it never
 * invents a "latest" decision that the API cannot enumerate.
 */
import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { RetryButton } from "@/components/retry-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EvidenceClassBadge } from "@/components/ui/evidence-class-badge";
import type { EvidenceClassId } from "@/lib/evidence";
import type { DecisionResult } from "@reckon/sdk";
import type { ReckonApiDisplayConfig } from "@/lib/reckon-client";
import type { ReckonApiProbe } from "@/lib/reckon-status";
import type { NextActionFailure, NextActionResult } from "@/lib/overview-data";
import styles from "./next-action-hero.module.css";

export interface NextActionHeroProps {
  readonly result: NextActionResult;
  readonly config: ReckonApiDisplayConfig;
  readonly probe: ReckonApiProbe;
}

/** Plain-language sentences per scheduler action — contract vocabulary only. */
function sentenceFor(decision: DecisionResult): { text: string; hasTarget: boolean } {
  const hasTarget = decision.selectedExperience !== undefined;
  switch (decision.action) {
    case "HOLD":
      return { text: "Hold the current experience — no change is warranted now.", hasTarget };
    case "CONTINUE":
      return { text: "Continue the current experience.", hasTarget };
    case "QUEUE":
      return {
        text: hasTarget
          ? "Queue this experience for later:"
          : "Queue an experience for later — none was attached to this decision.",
        hasTarget,
      };
    case "SUGGEST":
      return {
        text: hasTarget
          ? "Suggest this experience as the next step — surfaced, never forced:"
          : "Suggest the next step — no experience was attached to this decision.",
        hasTarget,
      };
    case "SWITCH":
      return {
        text: hasTarget
          ? "Switch to this experience now:"
          : "Switch — no target experience was attached to this decision.",
        hasTarget,
      };
    case "INTERRUPT":
      return { text: "Interrupt the current experience.", hasTarget };
    case "RESUME":
      return {
        text: hasTarget
          ? "Resume this experience from its checkpoint:"
          : "Resume from the saved checkpoint — no experience was attached to this decision.",
        hasTarget,
      };
    case "END":
      return { text: "End the current experience.", hasTarget };
  }
}

/** Duration is seconds (number) or an ISO-8601 duration string — render both honestly. */
function formatDuration(duration: number | string): string {
  if (typeof duration === "number") {
    if (duration < 60) {
      return `${duration}s`;
    }
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  }
  return duration;
}

const FAILURE_HEADINGS: Record<NextActionFailure["kind"], string> = {
  "not-configured": "No data loaded — demo key not set",
  unreachable: "API unreachable",
  unauthenticated: "Unauthenticated",
  "not-found": "Decision not found",
  "tenant-mismatch": "Tenant mismatch",
  "insufficient-scope": "Insufficient scope",
  "invalid-request": "Invalid decision id",
  "not-wired": "Route not wired",
  "contract-violation": "The API violated its contract",
  unknown: "Lookup failed",
};

function DegradedPanel({
  heading,
  message,
  code,
  extra,
}: {
  heading: string;
  message: string;
  code: string | null;
  extra?: ReactNode;
}) {
  return (
    <div className={styles.degraded}>
      <TriangleAlert className={styles.degradedIcon} aria-hidden="true" strokeWidth={1.5} size={24} />
      <h3 className={styles.degradedTitle}>{heading}</h3>
      <p className={styles.degradedMessage}>{message}</p>
      {code !== null ? <Badge uppercase>error {code}</Badge> : null}
      {extra}
      <RetryButton />
    </div>
  );
}

export function NextActionHero({ result, config, probe }: NextActionHeroProps) {
  const currentId =
    result.status === "failed"
      ? result.decisionId
      : result.status === "loaded"
        ? result.decision.decisionId
        : "";

  return (
    <Card padding="generous" className={styles.hero}>
      <div className={styles.header}>
        <h2 className={styles.question}>What should happen next?</h2>
        <p className={styles.lede}>
          The answer Reckon owes its host — one action over the live decision state, not a table
          dump. Grounded in the decision you load; nothing here is modeled or assumed.
        </p>
      </div>

      {result.status === "loaded" ? (
        <Answer decision={result.decision} fetchedAt={result.fetchedAt} />
      ) : null}

      {result.status === "idle" ? <IdleState config={config} probe={probe} /> : null}

      {result.status === "failed" ? (
        <DegradedPanel
          heading={FAILURE_HEADINGS[result.failure.kind]}
          message={result.failure.message}
          code={result.failure.code}
          extra={
            result.failure.kind === "unreachable" ? (
              <p className={styles.degradedExtra}>
                Connection check at {probe.checkedAt}: {probe.detail}
              </p>
            ) : null
          }
        />
      ) : null}

      <form action="/" method="get" className={styles.lookup} role="search">
        <label htmlFor="decision-lookup" className={styles.lookupLabel}>
          Decision id
        </label>
        <div className={styles.lookupRow}>
          <input
            id="decision-lookup"
            name="decision"
            type="text"
            className={styles.lookupInput}
            placeholder="decision id, as issued by POST /v1/decisions"
            defaultValue={currentId}
            autoComplete="off"
            spellCheck={false}
            required
            maxLength={128}
          />
          <Button type="submit" variant="primary" size="md" className={styles.lookupSubmit}>
            Load decision
          </Button>
          {currentId !== "" ? (
            <Link href="/" className={styles.lookupClear}>
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      <p className={styles.note}>
        Reads go through the server-side <code className={styles.noteCode}>@reckon/sdk</code> seam (
        <code className={styles.noteCode}>GET /v1/decisions/&#123;decisionId&#125;</code>) — the API
        endpoint is probed at page load and the demo key never reaches the browser. Reckon Studio
        renders only what the API returns — no fabricated answers, no invented confidence.
      </p>
    </Card>
  );
}

function Answer({ decision, fetchedAt }: { decision: DecisionResult; fetchedAt: string }) {
  const sentence = sentenceFor(decision);
  const experience = decision.selectedExperience;
  const confidence = decision.uncertainty?.confidence;
  const method = decision.uncertainty?.method;
  const latencyP50 = decision.latency?.latencyMsP50;
  const targetId = experience?.experienceId;

  return (
    <div className={styles.answer}>
      <div className={styles.answerRule} aria-hidden="true" />
      <div className={styles.answerBody}>
        <p className={styles.actionWord} title="Scheduler action ordered by this decision">
          {decision.action}
        </p>
        <p className={styles.sentence}>
          {sentence.text}
          {sentence.hasTarget && targetId !== undefined ? (
            <code className={styles.sentenceTarget}>{targetId}</code>
          ) : null}
        </p>

        {experience === undefined ? (
          <p className={styles.targetMeta}>No selected experience is attached to this decision.</p>
        ) : (
          <p className={styles.targetMeta}>
            experience <code className={styles.inlineCode}>{experience.experienceId}</code>
            {" · "}
            format {experience.format.kind}
            {experience.format.customKind === undefined ? "" : ` (${experience.format.customKind})`}
            {experience.duration === undefined ? "" : ` · ${formatDuration(experience.duration)}`}
            {experience.objectiveFit?.fitScore === undefined
              ? ""
              : ` · objective fit ${experience.objectiveFit.fitScore} (as reported)`}
          </p>
        )}

        <div className={styles.chips}>
          <Badge>
            policy {decision.policy.policyId}@{decision.policy.version}
          </Badge>
          {confidence === undefined ? null : (
            <Badge>
              confidence {confidence}
              {method === undefined ? "" : ` · ${method}`} (as reported)
            </Badge>
          )}
          {latencyP50 === undefined ? null : <Badge>latency p50 {latencyP50}ms (as reported)</Badge>}
          {decision.alternatives.length === 0 ? null : (
            <Badge>{decision.alternatives.length} alternatives considered</Badge>
          )}
          <EvidenceClassBadge evidenceClass={"observed" satisfies EvidenceClassId} />
        </div>

        <p className={styles.answerFootnote}>
          Decision <code className={styles.inlineCode}>{decision.decisionId}</code> · decided{" "}
          <time dateTime={new Date(decision.at).toISOString()}>
            {new Date(decision.at).toISOString()}
          </time>{" "}
          · read live at <time dateTime={fetchedAt}>{fetchedAt}</time>
        </p>
      </div>
    </div>
  );
}

function IdleState({ config, probe }: { config: ReckonApiDisplayConfig; probe: ReckonApiProbe }) {
  if (!config.demoApiKeyConfigured) {
    return (
      <DegradedPanel
        heading="No data loaded — demo key not set"
        message="RECKON_DEMO_API_KEY is not set in the server environment, so the studio cannot authenticate any read. Configure the demo key server-side (it never reaches the browser) and retry."
        code={null}
      />
    );
  }
  if (!probe.reachable) {
    return (
      <DegradedPanel
        heading="API unreachable"
        message="The studio cannot show an answer until the Reckon API answers. The lookup below will surface the precise failure if you try it now."
        code={null}
        extra={
          <p className={styles.degradedExtra}>
            Connection check at {probe.checkedAt}: {probe.detail}
          </p>
        }
      />
    );
  }
  return (
    <div className={styles.idle}>
      <p className={styles.idleMark} aria-hidden="true">
        —
      </p>
      <p className={styles.idleText}>
        No decision is loaded. The SDK surface exposes no <em>latest decision</em> and no{" "}
        <em>active plan</em> read — a decision is fetched by its id, exactly as a host integration
        would. Enter a decision id below to see Reckon&rsquo;s answer for it.
      </p>
      <p className={styles.idleHint}>
        API reachable at <code className={styles.inlineCode}>{probe.baseUrl}</code> · demo key
        configured — ready to read.
      </p>
    </div>
  );
}
