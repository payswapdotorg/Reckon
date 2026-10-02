# Environment Variables & Separation

**Status:** P1-004. Source of truth for the surface: `apps/api/src/config.ts`
(`loadConfigFromEnv`, `parseListenConfig`), `apps/api/src/main.ts`,
`packages/persistence/src/migrate-cli.ts`. Template: repo-root `.env.example`.

## 1. Matrix

| Variable              | Required | Default      | Format / validation                                              | Consumed by |
|-----------------------|----------|--------------|------------------------------------------------------------------|-------------|
| `DATABASE_URL`        | prod: yes (hard) | —     | `postgres://user:pass@host/db?sslmode=require` (Neon)            | `apps/api` main, `reckon-migrate`, `PgPoolExecutor` |
| `RECKON_API_KEYS`     | soft¹    | empty → all authenticated routes 401 | `key:tenant:scope1,scope2` entries, `;` or newline separated | `apps/api` auth |
| `RECKON_API_KEYS_FILE`| soft¹    | —            | path to a file with the same grammar (wins over the inline var)  | `apps/api` auth |
| `RECKON_PORT`         | no       | `8080`       | integer 1..65535; anything else → fail-fast `ConfigError` at boot | `apps/api` listen |
| `RECKON_HOST`         | no       | `127.0.0.1`  | bind host; public deployment sets `0.0.0.0` EXPLICITLY           | `apps/api` listen |
| `RECKON_LOG`          | no       | off          | `1` = fastify structured request logging (stdout)                 | `apps/api` logger |
| `RECKON_API_VERSION`  | no       | `0.1.0`      | free-form string reported by `/healthz` + `/readyz`              | `apps/api` |

¹ "soft": the process boots and says so loudly (stderr warning) — an API
without keys is a 401-everything API, which is a valid, honest degraded
state for a migration-only or health-only window. `DATABASE_URL` is the
only HARD requirement: without it the production composition exits 1
(ADR-001 — no hidden in-memory production authority).

## 2. Scope grammar (`RECKON_API_KEYS`)

```text
apiKey1:tenantA:decisions,plans,catalog;apiKey2:tenantB:outcomes
```

- one entry per `;` or newline; three `:`-separated parts exactly;
- keys must not contain `:`; hashed at rest by the `KeyStore`;
- unknown scope names are a boot-time `ConfigError` (fail fast, not a silent
  no-op scope);
- workspace-scoped keys are expressed programmatically only (tests / future
  host integration), never in the env string.

## 3. Per-environment separation

| Env      | `DATABASE_URL`                          | Keys                          | Host            | Log |
|----------|-----------------------------------------|-------------------------------|-----------------|-----|
| test     | embedded-postgres `127.0.0.1:55433/…` (harness) | per-test fixtures             | — (inject)      | off |
| dev      | local Postgres or a Neon dev branch     | one throwaway dev key         | `127.0.0.1`     | `1` |
| preview  | Neon preview branch                     | rotating preview key          | platform bind   | `1` |
| prod     | Neon main branch (`sslmode=require`)    | real per-tenant keys via file | `0.0.0.0`       | `1` |

Rules:

1. **Secrets never live in the repository.** `.gitignore` excludes `.env`
   and `.env.*`; only `.env.example` (no real values) is tracked. Real
   values are injected by the deployment platform's env store or a secrets
   file referenced by `RECKON_API_KEYS_FILE`.
2. **One environment = one database.** Never share a `DATABASE_URL` between
   environments; Neon branches are the intended isolation mechanism.
3. **The migrate CLI takes the same `DATABASE_URL`** (or an explicit
   `--database-url` flag for CI steps where env plumbing is awkward) —
   there is exactly one configuration surface, not two.
4. `RECKON_API_KEYS_FILE` beats `RECKON_API_KEYS` — file-based injection is
   the production path; the inline var is the dev path.

## 4. Boot-time validation behavior (tested)

- missing `DATABASE_URL` → stderr message + `exit 1` (main.ts);
- malformed `RECKON_PORT` → `ConfigError` naming the variable + `exit 1`
  (never a mystery `NaN` listen failure);
- malformed key entries / unknown scopes → `ConfigError` with entry index;
- empty keys → loud stderr warning, boot continues (honest degraded mode).
