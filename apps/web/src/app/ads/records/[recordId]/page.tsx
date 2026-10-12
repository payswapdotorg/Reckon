/**
 * Ad record detail (AD-005) — one Personal Ad Memory record: the
 * evidence trail (law 9/10), encounter context (by reference — law 5),
 * rights/retention state (laws 1/4), the append-only permission
 * history, and the per-record forget affordance.
 *
 * Data path: the public surface has NO get-record-by-id route (the
 * AD-002 `get` is a store port — recorded as UX_DX_GAP-3), so this page
 * resolves the record through the remembered lane at the request clock
 * and matches by recordId. A record that does not appear is honestly
 * not retrievable: forgotten (law 2, terminal), expired at the clock
 * (law 3), retain-revoked, or unknown — the view states exactly that
 * set, never a fabricated reason.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WorkspacePage } from "@/components/workspace-page";
import { AdDetail } from "@/components/ads/ad-detail";
import { AdsUnavailableState, AdsNotConfiguredState } from "@/components/ads/ads-unavailable-state";
import { EmptyState } from "@/components/empty-state";
import { formatEpochMs } from "@/lib/auth-view";
import { retrieveAdRecord } from "@/lib/ads-retrieval";
import { findWorkspaceRoute } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// The detail route is NOT a nav surface (like /login and /signup): it is
// reached from ad cards. Breadcrumbs/nav resolve to the Ads section.
const route = findWorkspaceRoute("/ads");
const title = "Remembered ad detail";

export const metadata: Metadata = {
  title,
  description:
    "One Personal Ad Memory record — evidence trail, encounter context, rights and retention state, permission history.",
};

interface AdRecordPageProps {
  readonly params: Promise<{ readonly recordId: string }>;
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export default async function AdRecordPage({ params }: AdRecordPageProps) {
  const { recordId } = await params;
  const decoded = decodeURIComponent(recordId);
  if (!ID_PATTERN.test(decoded)) {
    notFound();
  }

  const retrieval = await retrieveAdRecord(decoded);
  const clockLabel = formatEpochMs(retrieval.status === "found" ? retrieval.at : Date.now());

  return (
    <WorkspacePage
      title={title}
      subtitle={route?.subtitle ?? "One Personal Ad Memory record, in full."}
    >
      {retrieval.status === "not-configured" ? (
        <AdsNotConfiguredState surface="The record detail" reason={retrieval.reason} />
      ) : retrieval.status === "error" ? (
        <AdsUnavailableState surface="The record detail" failure={retrieval.failure} />
      ) : retrieval.status === "not-retrievable" ? (
        <EmptyState
          title="Record not retrievable"
          reason={`record “${decoded}” is not in the remembered lane at the evaluation clock — forgotten (terminal, law 2), expired at this clock (law 3), retain-revoked, or unknown to Personal Ad Memory`}
          note="The public ads surface resolves records through the remembered lane (no get-by-id route — UX_DX_GAP-3), and retrieval can never return a forgotten record again (law 2). Browse the remembered lane from Ads → Remembered ads."
          actionLabel="Retry"
        />
      ) : (
        <AdDetail record={retrieval.record} clockLabel={clockLabel} />
      )}
    </WorkspacePage>
  );
}
