/**
 * Developers › Request logs (S3-001) — the cursor-paginated log table
 * (time, method, route, status, latency, key prefix). The page state is
 * the URL itself: `starting_after` (the S2-001 cursor param) plus the
 * `cursor_history` trail that makes "Newer" possible on a forward-only
 * envelope. Server-rendered on every step — shareable and JS-optional.
 *
 * force-dynamic: the logs attempt resolves at request time and the page
 * renders exactly what was observed (honest states, Gate Q).
 */
import type { Metadata } from "next";
import { RequestLogsCard } from "@/components/developers/request-logs-card";
import { WorkspacePage } from "@/components/workspace-page";
import { fetchRequestLogs } from "@/lib/developers-surface";
import {
  logsPageNumber,
  nextLogsHref,
  parseLogsCursorParams,
  prevLogsHref,
} from "@/lib/request-logs-view";
import { requireWorkspaceRoute } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const route = requireWorkspaceRoute("/developers/logs");

export const metadata: Metadata = {
  title: route.title,
  description: route.subtitle,
};

interface LogsPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function RequestLogsPage({ searchParams }: LogsPageProps) {
  const params = await searchParams;
  const cursorState = parseLogsCursorParams(params);

  const result = await fetchRequestLogs({
    startingAfter: cursorState.current ?? undefined,
  });

  const nextHref =
    result.ok && result.data.pagination.has_more && result.data.pagination.next_cursor !== null
      ? nextLogsHref(cursorState, result.data.pagination)
      : null;
  const prevHref = prevLogsHref(cursorState);

  return (
    <WorkspacePage title={route.title} subtitle={route.subtitle}>
      <RequestLogsCard
        result={result}
        cursorState={cursorState}
        nextHref={nextHref}
        prevHref={prevHref}
        pageNumber={logsPageNumber(cursorState)}
      />
    </WorkspacePage>
  );
}
