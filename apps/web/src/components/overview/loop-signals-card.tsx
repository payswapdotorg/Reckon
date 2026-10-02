/**
 * LoopSignalsCards — UI-003 (FINAL TL HANDOFF §8): the remaining Overview
 * surfaces, grouped by the narrative they belong to:
 *
 *  - "The decision loop" — active plans, recent outcomes;
 *  - "Signals & state" — policy performance, decision latency, connected
 *    integrations, learning & research state.
 *
 * HONESTY LAW (Gate Q): each surface states what it WILL show once the
 * public API exposes it, and — when it has nothing real — the precise
 * reason nothing is shown (which SDK operation is missing). Surfaces with
 * real data render it verbatim with the `observed` evidence badge. No
 * surface ever fabricates activity, metrics, or connection state.
 */
import { ArrowRight, CalendarClock, ClipboardList, FlaskConical, Gauge, Plug, Timer } from "lucide-react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EvidenceClassBadge } from "@/components/ui/evidence-class-badge";
import type { NextActionResult } from "@/lib/overview-data";
import styles from "./loop-signals-card.module.css";

type SurfaceState =
  | {
      /** Real content read through the SDK — rendered verbatim. */
      readonly kind: "live";
      readonly content: ReactNode;
    }
  | {
      /** Nothing real to show — `reason` states precisely what is missing. */
      readonly kind: "absent";
      readonly reason: string;
    };

interface Surface {
  readonly id: string;
  readonly title: string;
  readonly icon: LucideIcon;
  /** What this surface shows once the API exposes it (product vocabulary). */
  readonly shows: string;
  readonly state: SurfaceState;
  readonly href?: string;
  readonly hrefLabel?: string;
}

function SurfaceRow({ surface }: { surface: Surface }) {
  const Icon = surface.icon;
  return (
    <li className={styles.surface}>
      <div className={styles.surfaceHead}>
        <Icon className={styles.surfaceIcon} aria-hidden="true" strokeWidth={1.75} size={16} />
        <h4 className={styles.surfaceTitle}>{surface.title}</h4>
        {surface.href !== undefined ? (
          <Link href={surface.href} className={styles.surfaceLink}>
            {surface.hrefLabel ?? surface.title}
            <ArrowRight aria-hidden="true" size={12} strokeWidth={1.75} />
          </Link>
        ) : null}
      </div>
      <p className={styles.shows}>{surface.shows}</p>
      {surface.state.kind === "live" ? (
        <div className={styles.live}>
          {surface.state.content}
          <EvidenceClassBadge evidenceClass="observed" />
        </div>
      ) : (
        <p className={styles.absent}>
          <span className={styles.absentLabel}>Not available</span>
          {surface.state.reason}
        </p>
      )}
    </li>
  );
}

function SurfaceGroupCard({
  title,
  description,
  surfaces,
}: {
  title: string;
  description: string;
  surfaces: readonly Surface[];
}) {
  return (
    <Card className={styles.card}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className={styles.surfaceList}>
          {surfaces.map((surface) => (
            <SurfaceRow key={surface.id} surface={surface} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function LoopSignalsCards({ result }: { result: NextActionResult }) {
  const decision = result.status === "loaded" ? result.decision : null;
  const delta = decision?.scheduleDelta ?? null;

  const loopSurfaces: readonly Surface[] = [
    {
      id: "plans",
      title: "Active plans",
      icon: CalendarClock,
      shows: "Each rolling plan — id, current stage, queue depth and replan count.",
      state:
        delta?.planId === undefined || delta === null
          ? {
              kind: "absent",
              reason:
                " — the SDK exposes no plan read. Hosts create and replan plans (write operations); Reckon Studio never writes, so no plan can be listed until the public API adds a read surface.",
            }
          : {
              kind: "live",
              content: (
                <span>
                  The loaded decision ordered <Badge uppercase>{delta.action}</Badge> on plan{" "}
                  <code className={styles.inlineCode}>{delta.planId}</code> — {delta.enqueue.length}{" "}
                  enqueued · {delta.dequeue.length} dequeued. No plan list or replan count is
                  readable through the SDK.
                </span>
              ),
            },
      href: "/plans",
      hrefLabel: "Plans workspace",
    },
    {
      id: "outcomes",
      title: "Recent outcomes",
      icon: ClipboardList,
      shows:
        "Outcome events as hosts reported them — event type (impression, completion, skip…), evidence class, and the decision each links back to.",
      state: {
        kind: "absent",
        reason:
          " — outcomes are append-only through the SDK (POST /v1/outcomes); no list or read operation exists, so an outcome trail cannot be shown without fabricating one.",
      },
    },
  ];

  const signalSurfaces: readonly Surface[] = [
    {
      id: "policy-performance",
      title: "Policy performance",
      icon: Gauge,
      shows: "How each deciding policy performs against its objective — win rates, calibration, drift.",
      state:
        decision === null
          ? {
              kind: "absent",
              reason:
                " — the SDK carries only the deciding policy id and version on each decision; no policy performance metrics surface exists to read.",
            }
          : {
              kind: "live",
              content: (
                <span>
                  The loaded decision was decided by policy{" "}
                  <code className={styles.inlineCode}>{decision.policy.policyId}</code>
                  @<code className={styles.inlineCode}>{decision.policy.version}</code>. Aggregate
                  performance: not available — no metrics surface exists in the SDK.
                </span>
              ),
            },
    },
    {
      id: "decision-latency",
      title: "Decision latency",
      icon: Timer,
      shows: "Decision latency (p50/p95) and inference cost — per decision, and in aggregate.",
      state:
        decision?.latency === undefined || decision === null
          ? {
              kind: "absent",
              reason:
                decision === null
                  ? " — per-decision latency travels on decision results (optional fields); load a decision above to inspect it. No aggregate latency surface exists in the SDK."
                  : " — the loaded decision carried no latency metadata; the cost fields are optional in the decision contract.",
            }
          : {
              kind: "live",
              content: (
                <span>
                  {decision.latency.latencyMsP50 === undefined
                    ? "p50 not reported"
                    : `p50 ${decision.latency.latencyMsP50}ms`}
                  {" · "}
                  {decision.latency.latencyMsP95 === undefined
                    ? "p95 not reported"
                    : `p95 ${decision.latency.latencyMsP95}ms`}
                  {decision.latency.inferenceCost === undefined
                    ? ""
                    : ` · cost ${decision.latency.inferenceCost}${
                        decision.latency.currency ? ` ${decision.latency.currency}` : ""
                      }`}{" "}
                  (as reported on this decision). Aggregate latency: no surface in the SDK.
                </span>
              ),
            },
    },
    {
      id: "integrations",
      title: "Connected integrations",
      icon: Plug,
      shows:
        "Which host integrations are connected — catalog import, candidate mapping, outcome mapping — and which are verified live versus merely declared.",
      state: {
        kind: "absent",
        reason:
          " — the SDK exposes no integrations surface; adapter capability cards and their live verification status have no read path through the public API yet.",
      },
      href: "/integrations",
      hrefLabel: "Integrations workspace",
    },
    {
      id: "learning",
      title: "Learning & research state",
      icon: FlaskConical,
      shows:
        "The learning ladder — supervised, bandit, offline, simulated and bounded-live experiments — with evidence classes and calibration.",
      state: {
        kind: "absent",
        reason:
          " — the SDK exposes no learning or research state; experiments are not readable through the public surface.",
      },
      href: "/research",
      hrefLabel: "Research workspace",
    },
  ];

  return (
    <div className={styles.grid}>
      <SurfaceGroupCard
        title="The decision loop"
        description="Plans order the future, decisions act now, outcomes feed the next decision. What the public API exposes of each stage today:"
        surfaces={loopSurfaces}
      />
      <SurfaceGroupCard
        title="Signals & state"
        description="The measured and declared state Reckon can account for through its public surface:"
        surfaces={signalSurfaces}
      />
    </div>
  );
}
