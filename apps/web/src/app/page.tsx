/**
 * Home — the operator dashboard landing (S3-001), built on the UI-003
 * overview foundation.
 *
 * Composition, top to bottom:
 *  1. ACCOUNT STATUS — live status strip: the real /healthz probe, the
 *     account mode badge (the test/live toggle's indicator) and the
 *     operator quick links into the dashboard sections;
 *  2. SERVE YOUR FIRST RECOMMENDATION — the onboarding card tying the
 *     dashboard to the docs quickstart (S1-004);
 *  3. WHAT SHOULD HAPPEN NEXT? — the answer card: a real decision read
 *     live through the SDK seam by id, or the honest idle/degraded state
 *     with the by-id lookup affordance;
 *  4. Decision activity — the contract-validated record behind the answer;
 *  5. The decision loop / Signals & state — every remaining §8 surface;
 *  6. System status — the foundation's real /healthz probe surface.
 *
 * force-dynamic: the probe, the SDK read and searchParams resolve at
 * request time so the page shows what was actually observed — never a
 * build-time snapshot and never fabricated state (Gate Q).
 */
import type { Metadata } from "next";
import { AccountStatusCard } from "@/components/home/account-status-card";
import { OnboardingCard } from "@/components/home/onboarding-card";
import { DecisionActivityCard } from "@/components/overview/decision-activity-card";
import { LoopSignalsCards } from "@/components/overview/loop-signals-card";
import { NextActionHero } from "@/components/overview/next-action-hero";
import { SystemStatusCard } from "@/components/system-status-card";
import { WorkspacePage } from "@/components/workspace-page";
import { getReckonApiDisplayConfig } from "@/lib/reckon-client";
import { probeReckonApi } from "@/lib/reckon-status";
import { loadNextAction, normalizeDecisionId } from "@/lib/overview-data";
import { requireWorkspaceRoute } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const home = requireWorkspaceRoute("/");

/** Docs portal origin (S1-004); overridable per deployment. */
const DEFAULT_DOCS_BASE_URL = "https://docs.reckon.dev";

function quickstartHref(): string {
  const base = process.env.RECKON_DOCS_BASE_URL?.trim() || DEFAULT_DOCS_BASE_URL;
  return `${base.replace(/\/$/, "")}/get-started/quickstart`;
}

export const metadata: Metadata = {
  title: home.title,
  description: home.subtitle,
};

interface HomePageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const decisionId = normalizeDecisionId(params.decision);

  const [config, probe, result] = await Promise.all([
    getReckonApiDisplayConfig(),
    probeReckonApi(),
    loadNextAction(decisionId),
  ]);

  return (
    <WorkspacePage title={home.title} subtitle={home.subtitle}>
      <AccountStatusCard config={config} probe={probe} />
      <OnboardingCard quickstartHref={quickstartHref()} />
      <NextActionHero result={result} config={config} probe={probe} />
      <DecisionActivityCard result={result} />
      <LoopSignalsCards result={result} />
      <SystemStatusCard config={config} probe={probe} />
    </WorkspacePage>
  );
}
