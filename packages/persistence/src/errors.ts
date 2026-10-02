/**
 * Typed persistence-layer errors (P1-001).
 *
 * Event-domain rejections reuse the frozen @reckon/events error classes
 * (EventValidationError, EventIdConflictError, correction errors) so the
 * transport/sink error contracts stay identical across the in-memory test
 * infrastructure and the production PostgreSQL adapters. This module adds
 * only persistence-owned codes.
 */

/** Base class for persistence-layer typed errors. */
export class PersistenceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PersistenceError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** A migration failed to apply (includes the migration id). */
export class MigrationError extends PersistenceError {
  readonly migrationId: string;

  constructor(migrationId: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super("PERSISTENCE_MIGRATION_FAILED", `migration ${migrationId} failed: ${message}`);
    this.name = "MigrationError";
    this.migrationId = migrationId;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** An authoritative-state id was reused with different content. */
export class StateIdConflictError extends PersistenceError {
  readonly kind: string;
  readonly tenantId: string;
  readonly id: string;

  constructor(kind: string, tenantId: string, id: string, message: string) {
    super("PERSISTENCE_STATE_ID_CONFLICT", message);
    this.name = "StateIdConflictError";
    this.kind = kind;
    this.tenantId = tenantId;
    this.id = id;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** A stored record failed to parse back through its frozen schema. */
export class StoredRecordParseError extends PersistenceError {
  readonly kind: string;
  readonly id: string | undefined;

  constructor(kind: string, id: string | undefined, message: string) {
    super("PERSISTENCE_STORED_RECORD_INVALID", message);
    this.name = "StoredRecordParseError";
    this.kind = kind;
    this.id = id;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** A research-job lease operation was rejected. */
export class ResearchJobError extends PersistenceError {
  readonly jobId: string;

  constructor(jobId: string, message: string) {
    super("PERSISTENCE_RESEARCH_JOB_REJECTED", message);
    this.name = "ResearchJobError";
    this.jobId = jobId;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
