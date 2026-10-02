/**
 * PgAgentStore — tenant-scoped persistence for Agent Body and Agent
 * Organization declarations (UI-007).
 *
 * The frozen AgentBody/AgentOrganization contracts carry NO tenant field —
 * tenant scope arrives from the AUTH context (the catalog-ingest pattern,
 * not the plans pattern). Declarations are versioned append-only like
 * plans: stored under (tenant, workspace, id, version) with a content
 * digest; re-putting the SAME version with different content is a typed
 * conflict; a new version appends (never overwrites). `stored_at` uses
 * infra wall-clock for recency listing only (bookkeeping, not a
 * contract-visible timestamp — declarations carry their own provenance).
 *
 * The runtimes in @reckon/agents / @reckon/organization remain the
 * enforcement machinery; this store is the durable declaration surface.
 */
import { createHash } from "node:crypto";
import { AgentBodySchema, AgentOrganizationSchema } from "@reckon/contracts";
import type { AgentBody, AgentOrganization } from "@reckon/contracts";
import type { SqlExecutor } from "./executor.js";
import { StateIdConflictError } from "./errors.js";

export interface TenantScope {
  readonly tenantId: string;
  readonly workspaceId?: string;
}

function tenantColumns(tenant: TenantScope): { tenantId: string; workspaceId: string } {
  return { tenantId: tenant.tenantId, workspaceId: tenant.workspaceId ?? "" };
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, v) =>
      typeof v === "object" && v !== null && !Array.isArray(v)
        ? Object.keys(v as Record<string, unknown>)
            .sort()
            .reduce<Record<string, unknown>>((acc, k) => {
              acc[k] = (v as Record<string, unknown>)[k];
              return acc;
            }, {})
        : v,
  );
}

function digestOf(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export interface StoredAgentBody {
  readonly body: AgentBody;
  readonly storedAt: number;
}

export interface StoredAgentOrganization {
  readonly organization: AgentOrganization;
  readonly storedAt: number;
}

export class PgAgentStore {
  readonly #executor: SqlExecutor;
  readonly #now: () => number;

  constructor(executor: SqlExecutor, now: () => number = () => Date.now()) {
    this.#executor = executor;
    this.#now = now;
  }

  /** Create or version-append one Agent Body declaration (tenant from auth). */
  async putBody(tenant: TenantScope, body: AgentBody): Promise<StoredAgentBody> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const existing = await this.#executor.query(
      `SELECT content_digest FROM agent_bodies
       WHERE tenant_id = $1 AND workspace_id = $2 AND body_id = $3 AND body_version = $4`,
      [tenantId, workspaceId, body.bodyId, body.version],
    );
    const digest = digestOf(body);
    if (existing.length > 0) {
      if (String(existing[0]?.content_digest) !== digest) {
        throw new StateIdConflictError(
          "agent-body",
          tenantId,
          `${body.bodyId}@${body.version}`,
          `agent body ${body.bodyId} version ${body.version} already exists with different content`,
        );
      }
      return { body, storedAt: 0 }; // idempotent re-put of the exact same declaration
    }
    const storedAt = this.#now();
    await this.#executor.query(
      `INSERT INTO agent_bodies (tenant_id, workspace_id, body_id, body_version, body_json, content_digest, stored_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
      [tenantId, workspaceId, body.bodyId, body.version, canonicalJson(body), digest, storedAt],
    );
    return { body, storedAt };
  }

  /** Latest-stored version of one body, or null. */
  async getBody(tenant: TenantScope, bodyId: string): Promise<StoredAgentBody | null> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const rows = await this.#executor.query(
      `SELECT body_json, stored_at FROM agent_bodies
       WHERE tenant_id = $1 AND workspace_id = $2 AND body_id = $3
       ORDER BY stored_at DESC, body_version DESC LIMIT 1`,
      [tenantId, workspaceId, bodyId],
    );
    if (rows.length === 0) return null;
    return {
      body: AgentBodySchema.parse(rows[0]?.body_json),
      storedAt: Number(rows[0]?.stored_at),
    };
  }

  /** Latest-stored version of each body, newest first (bounded). */
  async listBodies(tenant: TenantScope, limit = 20): Promise<readonly StoredAgentBody[]> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const rows = await this.#executor.query(
      `SELECT DISTINCT ON (body_id) body_id, body_json, stored_at
       FROM agent_bodies
       WHERE tenant_id = $1 AND workspace_id = $2
       ORDER BY body_id, stored_at DESC, body_version DESC`,
      [tenantId, workspaceId],
    );
    const bodies = rows.map((row) => ({
      body: AgentBodySchema.parse(row.body_json),
      storedAt: Number(row.stored_at),
    }));
    bodies.sort((a, b) => b.storedAt - a.storedAt);
    return bodies.slice(0, Math.max(1, Math.min(limit, 100)));
  }

  /** Create or version-append one Agent Organization declaration. */
  async putOrganization(
    tenant: TenantScope,
    organization: AgentOrganization,
  ): Promise<StoredAgentOrganization> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const existing = await this.#executor.query(
      `SELECT content_digest FROM agent_organizations
       WHERE tenant_id = $1 AND workspace_id = $2 AND organization_id = $3 AND org_version = $4`,
      [tenantId, workspaceId, organization.organizationId, organization.version],
    );
    const digest = digestOf(organization);
    if (existing.length > 0) {
      if (String(existing[0]?.content_digest) !== digest) {
        throw new StateIdConflictError(
          "agent-organization",
          tenantId,
          `${organization.organizationId}@${organization.version}`,
          `agent organization ${organization.organizationId} version ${organization.version} already exists with different content`,
        );
      }
      return { organization, storedAt: 0 };
    }
    const storedAt = this.#now();
    await this.#executor.query(
      `INSERT INTO agent_organizations (tenant_id, workspace_id, organization_id, org_version, org_json, content_digest, stored_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
      [
        tenantId,
        workspaceId,
        organization.organizationId,
        organization.version,
        canonicalJson(organization),
        digest,
        storedAt,
      ],
    );
    return { organization, storedAt };
  }

  /** Latest-stored version of one organization, or null. */
  async getOrganization(
    tenant: TenantScope,
    organizationId: string,
  ): Promise<StoredAgentOrganization | null> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const rows = await this.#executor.query(
      `SELECT org_json, stored_at FROM agent_organizations
       WHERE tenant_id = $1 AND workspace_id = $2 AND organization_id = $3
       ORDER BY stored_at DESC, org_version DESC LIMIT 1`,
      [tenantId, workspaceId, organizationId],
    );
    if (rows.length === 0) return null;
    return {
      organization: AgentOrganizationSchema.parse(rows[0]?.org_json),
      storedAt: Number(rows[0]?.stored_at),
    };
  }

  /** Latest-stored version of each organization, newest first (bounded). */
  async listOrganizations(
    tenant: TenantScope,
    limit = 20,
  ): Promise<readonly StoredAgentOrganization[]> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const rows = await this.#executor.query(
      `SELECT DISTINCT ON (organization_id) organization_id, org_json, stored_at
       FROM agent_organizations
       WHERE tenant_id = $1 AND workspace_id = $2
       ORDER BY organization_id, stored_at DESC, org_version DESC`,
      [tenantId, workspaceId],
    );
    const orgs = rows.map((row) => ({
      organization: AgentOrganizationSchema.parse(row.org_json),
      storedAt: Number(row.stored_at),
    }));
    orgs.sort((a, b) => b.storedAt - a.storedAt);
    return orgs.slice(0, Math.max(1, Math.min(limit, 100)));
  }
}
