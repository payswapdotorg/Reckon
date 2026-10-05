/**
 * Developers › Events (S3-001) — the webhook-events console: type,
 * created, delivery status, replay (placeholder — S2-002 lands the
 * backend). The page attempts GET /v1/events server-side and renders
 * exactly what was observed; the planned event catalog is shown as
 * labeled roadmap, never as data (Gate Q).
 */
import type { Metadata } from "next";
import { EventsConsole } from "@/components/developers/events-console";
import { WorkspacePage } from "@/components/workspace-page";
import { fetchEvents } from "@/lib/developers-surface";
import { requireWorkspaceRoute } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const route = requireWorkspaceRoute("/developers/events");

export const metadata: Metadata = {
  title: route.title,
  description: route.subtitle,
};

export default async function EventsPage() {
  const result = await fetchEvents({ limit: 20 });

  return (
    <WorkspacePage title={route.title} subtitle={route.subtitle}>
      <EventsConsole result={result} />
    </WorkspacePage>
  );
}
