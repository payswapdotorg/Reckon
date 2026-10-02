/**
 * Research — the research workspace (UI-008): the learning ladder with
 * evidence-class discipline + the durable research-job queue.
 *
 * force-dynamic: the queue read resolves at request time — never a
 * build-time snapshot, never fabricated state (Gate Q).
 */
import type { Metadata } from "next";
import { LearningLadder } from "@/components/research/learning-ladder";
import { ResearchQueueCard } from "@/components/research/research-queue-card";
import { WorkspacePage } from "@/components/workspace-page";
import { getReckonApiDisplayConfig } from "@/lib/reckon-client";
import { listResearchJobs } from "@/lib/research-retrieval";
import { requireWorkspaceRoute } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const route = requireWorkspaceRoute("/research");

export const metadata: Metadata = {
  title: route.title,
  description: route.subtitle,
};

export default async function ResearchPage() {
  const [listing, apiConfig] = await Promise.all([
    listResearchJobs(),
    getReckonApiDisplayConfig(),
  ]);

  return (
    <WorkspacePage title={route.title} subtitle={route.subtitle}>
      <LearningLadder />
      <ResearchQueueCard listing={listing} apiKeyNotConfigured={!apiConfig.demoApiKeyConfigured} />
    </WorkspacePage>
  );
}
