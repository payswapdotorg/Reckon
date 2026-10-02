/**
 * Research retrieval loader (UI-008) — server-side data path through the
 * SDK research surface (GET /v1/research/jobs). Never throws, never
 * fabricates (Gate Q).
 */
import "server-only";

import { isReckonSdkError, type ResearchJobView } from "@reckon/sdk";
import { getReckonClient, ReckonClientNotConfiguredError } from "./reckon-client";

export type ResearchJobsListing =
  | { readonly status: "not-configured" }
  | {
      readonly status: "error";
      readonly code: string;
      readonly message: string;
      readonly statusCode: number | undefined;
    }
  | { readonly status: "found"; readonly jobs: readonly ResearchJobView[] };

export async function listResearchJobs(limit = 20): Promise<ResearchJobsListing> {
  try {
    const jobs = await getReckonClient().research.listJobs({ limit });
    return { status: "found", jobs };
  } catch (error) {
    if (error instanceof ReckonClientNotConfiguredError) {
      return { status: "not-configured" };
    }
    const code = isReckonSdkError(error) ? error.code : "UNEXPECTED";
    const message = error instanceof Error ? error.message : String(error);
    const statusCode = isReckonSdkError(error) ? error.statusCode : undefined;
    return { status: "error", code, message, statusCode };
  }
}
