/**
 * Agent retrieval loader (UI-007) — server-side data path through the SDK
 * read surface (GET /v1/agents/bodies|organizations + by-id lookups).
 * Never throws, never fabricates (Gate Q).
 */
import "server-only";

import { isReckonSdkError, type AgentBody, type AgentOrganization } from "@reckon/sdk";
import { getReckonClient, ReckonClientNotConfiguredError } from "./reckon-client";

export type AgentRetrieval<T> =
  | { readonly status: "idle" }
  | { readonly status: "not-configured"; readonly kind: string; readonly reason: string }
  | {
      readonly status: "error";
      readonly kind: string;
      readonly code: string;
      readonly message: string;
      readonly statusCode: number | undefined;
    }
  | { readonly status: "found"; readonly kind: string; readonly value: T };

export interface AgentListings {
  readonly bodies: AgentRetrieval<readonly AgentBody[]>;
  readonly organizations: AgentRetrieval<readonly AgentOrganization[]>;
}

function classify(error: unknown): { code: string; message: string; statusCode: number | undefined } {
  if (isReckonSdkError(error)) {
    return { code: error.code, message: error.message, statusCode: error.statusCode };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: "UNEXPECTED", message, statusCode: undefined };
}

async function retrieve<T>(
  kind: string,
  op: () => Promise<T>,
): Promise<AgentRetrieval<T>> {
  try {
    const value = await op();
    return { status: "found", kind, value };
  } catch (error) {
    if (error instanceof ReckonClientNotConfiguredError) {
      return { status: "not-configured", kind, reason: error.message };
    }
    const { code, message, statusCode } = classify(error);
    return { status: "error", kind, code, message, statusCode };
  }
}

export async function retrieveBody(bodyId: string): Promise<AgentRetrieval<AgentBody>> {
  return retrieve("body", () => getReckonClient().agents.getBody(bodyId));
}

export async function retrieveOrganization(
  organizationId: string,
): Promise<AgentRetrieval<AgentOrganization>> {
  return retrieve("organization", () =>
    getReckonClient().agents.getOrganization(organizationId),
  );
}

export async function listAgentSurfaces(limit = 20): Promise<AgentListings> {
  const client = getReckonClient();
  const [bodies, organizations] = await Promise.all([
    retrieve("bodies", () => client.agents.listBodies({ limit })),
    retrieve("organizations", () => client.agents.listOrganizations({ limit })),
  ]);
  return { bodies, organizations };
}

/** Normalize ?org= / ?body= params (ids, 1..128). */
export function normalizeAgentParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) value = value[0];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 128) : undefined;
}
