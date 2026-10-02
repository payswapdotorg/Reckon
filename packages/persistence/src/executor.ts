/**
 * SqlExecutor — the narrow SQL access port for @reckon/persistence.
 *
 * Production implementation (PgPoolExecutor) wraps a `pg` (node-postgres)
 * Pool — the SAME driver and wire protocol used against Neon PostgreSQL in
 * deployment (ADR-001). Tests run the identical executor against a REAL
 * PostgreSQL server booted via embedded-postgres (evidence class for those
 * runs: controlled-local — the wire path against deployed infrastructure is
 * Gate L evidence, produced with a real DATABASE_URL).
 *
 * Laws honored here:
 * - parameters only (no string interpolation of values into SQL);
 * - transactions are explicit and composable (nested → SAVEPOINT);
 * - infra errors propagate as thrown Errors (callers classify them as
 *   transient per the OutcomeSink error contract).
 */
import pg from "pg";

export interface SqlRow {
  readonly [column: string]: unknown;
}

export interface SqlExecutor {
  /** Execute a parameterized statement; returns the selected rows. */
  query(text: string, params?: readonly unknown[]): Promise<readonly SqlRow[]>;
  /**
   * Run `fn` inside a transaction. A nested call within an ambient
   * transaction opens a SAVEPOINT instead (composable, no deadlock).
   */
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  /** Close underlying resources (idempotent). */
  close(): Promise<void>;
}

/** Pool-scoped executor state (one Pool per executor instance). */
interface PoolState {
  readonly pool: pg.Pool;
  closed: boolean;
}

const SAVEPOINT_COUNTER = Symbol("savepointCounter");

interface TransactionScope {
  readonly client: pg.PoolClient;
  readonly depth: number;
}

interface TxScopedExecutor extends SqlExecutor {
  readonly [SAVEPOINT_COUNTER]: { next: () => number };
}

/**
 * The production executor. Construct either from a connection string
 * (DATABASE_URL) or by adopting an externally-owned pg.Pool.
 *
 * ```ts
 * const executor = new PgPoolExecutor({ connectionString: process.env.DATABASE_URL });
 * ```
 */
export class PgPoolExecutor implements SqlExecutor {
  readonly #state: PoolState;

  constructor(
    config:
      | { readonly connectionString?: string; readonly max?: number; readonly idleTimeoutMillis?: number }
      | { readonly pool: pg.Pool },
  ) {
    const pool = "pool" in config ? config.pool : new pg.Pool({
      connectionString: config.connectionString,
      max: config.max ?? 10,
      idleTimeoutMillis: config.idleTimeoutMillis ?? 30_000,
    });
    // Pool background errors (e.g. an idle client terminated by a server
    // shutdown) surface on stderr — observable, never silently swallowed,
    // but NOT process-fatal: the pool already retired the dead client and
    // no in-flight query is affected by construction (queries reject
    // through their own promise chains).
    pool.on("error", (err) => {
      process.stderr.write(`[PgPoolExecutor] idle-client error: ${err.message}\n`);
    });
    this.#state = { pool, closed: false };
  }

  async query(text: string, params: readonly unknown[] = []): Promise<readonly SqlRow[]> {
    if (this.#state.closed) {
      throw new Error("PgPoolExecutor.query: pool already closed");
    }
    const result = await this.#state.pool.query(text, params as unknown[]);
    return result.rows as readonly SqlRow[];
  }

  async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    if (this.#state.closed) {
      throw new Error("PgPoolExecutor.transaction: pool already closed");
    }
    const client = await this.#state.pool.connect();
    let scope: TransactionScope = { client, depth: 0 };
    try {
      await client.query("BEGIN");
      const result = await fn(new PoolClientExecutor(() => scope, (next) => (scope = next)));
      if (scope.depth > 0) {
        throw new Error(
          "PgPoolExecutor.transaction: transaction scope leaked (unbalanced savepoint)",
        );
      }
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The connection is broken; releasing it is the best we can do.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (this.#state.closed) return;
    this.#state.closed = true;
    await this.#state.pool.end();
  }
}

/**
 * Executor bound to one transaction's client. `transaction()` re-entry
 * opens a SAVEPOINT (sp_1, sp_2, … per nesting depth) so composition
 * code can call transaction() freely without deadlocking itself.
 */
class PoolClientExecutor implements TxScopedExecutor {
  readonly [SAVEPOINT_COUNTER] = { next: (() => { let n = 0; return () => (n += 1); })() };

  readonly #getScope: () => TransactionScope;
  readonly #setScope: (scope: TransactionScope) => void;

  constructor(
    getScope: () => TransactionScope,
    setScope: (scope: TransactionScope) => void,
  ) {
    this.#getScope = getScope;
    this.#setScope = setScope;
  }

  async query(text: string, params: readonly unknown[] = []): Promise<readonly SqlRow[]> {
    const { client } = this.#getScope();
    const result = await client.query(text, params as unknown[]);
    return result.rows as readonly SqlRow[];
  }

  async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    const scope = this.#getScope();
    const savepoint = `sp_${scope.depth + 1}`;
    this.#setScope({ ...scope, depth: scope.depth + 1 });
    try {
      await scope.client.query(`SAVEPOINT ${savepoint}`);
      const result = await fn(this);
      const after = this.#getScope();
      await after.client.query(`RELEASE SAVEPOINT ${savepoint}`);
      this.#setScope({ ...after, depth: after.depth - 1 });
      return result;
    } catch (error) {
      const after = this.#getScope();
      await after.client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      this.#setScope({ ...after, depth: after.depth - 1 });
      throw error;
    }
  }

  async close(): Promise<void> {
    // Closing a transaction-scoped executor is a no-op: the ambient
    // transaction owns the connection lifecycle.
  }
}
