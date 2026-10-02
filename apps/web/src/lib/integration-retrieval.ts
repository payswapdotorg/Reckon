/**
 * Integration retrieval loader (UI-009) — server-side data path through
 * the SDK integrations surface (GET /v1/integrations/adapters).
 * Never throws, never fabricates (Gate Q).
 */
import "server-only";

import { isReckonSdkError, type AdapterDeclarationView } from "@reckon/sdk";
import { getReckonClient, ReckonClientNotConfiguredError } from "./reckon-client";

export type AdaptersListing =
  | { readonly status: "not-configured" }
  | {
      readonly status: "error";
      readonly code: string;
      readonly message: string;
      readonly statusCode: number | undefined;
    }
  | { readonly status: "found"; readonly adapters: readonly AdapterDeclarationView[] };

export async function listAdapters(): Promise<AdaptersListing> {
  try {
    const adapters = await getReckonClient().integrations.listAdapters();
    return { status: "found", adapters };
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
