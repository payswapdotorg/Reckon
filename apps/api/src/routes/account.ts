import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  ACCOUNT_ROUTE_PATHS,
  AccountKeyCreatedSchema,
  AccountKeySchema,
  AccountSessionResponseSchema,
  CreateKeyRequestSchema,
  LoginRequestSchema,
  PublishableApiKeySchema,
  SecretApiKeySchema,
  SessionTokenSchema,
  SignupRequestSchema,
} from "@reckon/contracts";
import {
  AccountEmailTakenError,
  type AccountKeyView,
  type AccountRecord,
  type MintedAccountKey,
  type StoredAccountKeyAuth,
} from "@reckon/persistence";
import { ApiError, ERROR_CODES } from "../errors.js";
import { ROUTE_SCOPES } from "../types.js";
import { parseRequestBody, validateHandlerResponse } from "./shared.js";

/**
 * TL6-001 — the /v1/account route family: self-serve signup, login,
 * logout and account-key management. This family is SESSION-authenticated
 * (`Authorization: Bearer reckonsess_<token>` — a DISTINCT prefix so the
 * API-key pipeline is untouched) and therefore rides its own preHandler,
 * NOT the key-auth pipeline (scopes/idempotency/X-Reckon-Mode belong to
 * key-authenticated routes). Typed error envelopes are shared with the
 * rest of the API.
 *
 *   POST   /v1/account/signup        201 account + session (token shown ONCE)
 *                                   409 EMAIL_TAKEN when the email exists
 *   POST   /v1/account/login         200 account + session (401 on bad credentials)
 *   POST   /v1/account/logout        204 (session revoked)
 *   GET    /v1/account/keys          200 keys newest-first (NO secrets, ever)
 *   POST   /v1/account/keys          201 minted key + RAW key shown EXACTLY ONCE
 *   DELETE /v1/account/keys/:keyId   204 (revoke; 404 unknown id)
 *
 * SHOW-ONCE LAW (S2-001/S2-002 posture): raw session tokens and raw key
 * values appear in exactly ONE response each — the one that minted them.
 * The persistence layer stores only sha256 hashes; nothing here logs raw
 * passwords, raw tokens or raw keys.
 */

/**
 * The account stores this family answers through, as STRUCTURAL ports —
 * the durable @reckon/persistence implementations (PgAccountStore & co.)
 * satisfy them directly in the production composition; in-process test
 * infrastructure may satisfy them equally (ADR-001: production authority
 * is always the real PostgreSQL stores, never a substitute).
 */
export interface AccountStorePort {
  create(input: { email: string; password: string; fullName: string }): Promise<AccountRecord>;
  findByEmail(email: string): Promise<AccountRecord | null>;
  findById(id: string): Promise<AccountRecord | null>;
  verifyPassword(email: string, password: string): Promise<AccountRecord | null>;
}

export interface AccountKeyStorePort {
  mint(
    account: Pick<AccountRecord, "id" | "tenantId" | "tier">,
    request: { kind: "secret" | "publishable"; mode: "live" | "test" },
    scopes?: readonly string[],
  ): Promise<MintedAccountKey>;
  list(accountId: string): Promise<readonly AccountKeyView[]>;
  revoke(accountId: string, keyId: string): Promise<AccountKeyView | null>;
  findByKeyHash(keyHash: string): Promise<StoredAccountKeyAuth | null>;
  touchLastUsed(keyHash: string): Promise<void>;
}

export interface AccountSessionStorePort {
  create(accountId: string): Promise<{ token: string; expiresAt: number }>;
  validate(token: string): Promise<{ accountId: string; expiresAt: number } | null>;
  revoke(token: string): Promise<boolean>;
}

export interface AccountRouteDeps {
  readonly accounts: AccountStorePort;
  readonly keys: AccountKeyStorePort;
  readonly sessions: AccountSessionStorePort;
}

function sessionUnauthenticated(message: string): ApiError {
  return new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, message);
}

/**
 * The SESSION preHandler: bearer reckonsess_<token> → validated session →
 * the owning account. A missing/malformed/expired token is a typed 401;
 * an API key presented here gets a message pointing at the right family.
 */
function accountSessionPreHandler(deps: AccountRouteDeps) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const header = request.headers.authorization;
    const match = /^Bearer[ \t]+(\S+)$/i.exec(typeof header === "string" ? header : "");
    const presented = match?.[1];
    if (presented === undefined) {
      throw sessionUnauthenticated(
        "Missing Authorization header (expected 'Authorization: Bearer reckonsess_<token>' from signup or login)",
      );
    }
    if (SecretApiKeySchema.safeParse(presented).success || PublishableApiKeySchema.safeParse(presented).success) {
      throw sessionUnauthenticated(
        "API keys (sk_/pk_) cannot authenticate the /v1/account routes; use the session token issued at signup or login",
      );
    }
    if (!SessionTokenSchema.safeParse(presented).success) {
      throw sessionUnauthenticated(
        "Authorization header must carry a session token: 'Bearer reckonsess_<token>' (issued once at signup or login)",
      );
    }
    const session = await deps.sessions.validate(presented);
    if (session === null) {
      throw sessionUnauthenticated("Session token is invalid or expired; log in again");
    }
    const account = await deps.accounts.findById(session.accountId);
    if (account === null) {
      // The session outlived its account — an honest 401, never a crash.
      throw sessionUnauthenticated("Session token is invalid or expired; log in again");
    }
    // The raw token is retained ONLY for the logout revocation; it never
    // leaves the request scope and is never logged.
    request.reckonAccountSession = { account, sessionToken: presented };
  };
}

/** The decorated session context (throws the typed 500 when the preHandler did not run). */
function requireAccountSession(request: FastifyRequest): NonNullable<FastifyRequest["reckonAccountSession"]> {
  const session = request.reckonAccountSession;
  if (session === undefined) {
    throw new ApiError(
      ERROR_CODES.INTERNAL,
      500,
      "Account session context missing: the session preHandler did not run for this route",
    );
  }
  return session;
}

export function registerAccountRoutes(app: FastifyInstance, deps: AccountRouteDeps): void {
  /* ---------------- signup (unauthenticated) ---------------- */

  app.post(ACCOUNT_ROUTE_PATHS.signup, async (request, reply) => {
    const body = parseRequestBody(SignupRequestSchema, request, "reckon.api.signup-request");
    let account;
    try {
      // workspaceName is validated by the frozen contract; TL6-001 has no
      // workspace sub-resource to persist it into yet (documented honestly).
      account = await deps.accounts.create({
        email: body.email,
        password: body.password,
        fullName: body.fullName,
      });
    } catch (error) {
      if (error instanceof AccountEmailTakenError) {
        throw new ApiError(
          ERROR_CODES.EMAIL_TAKEN,
          409,
          "An account with this email already exists",
          { email: body.email },
          "email",
        );
      }
      throw error;
    }
    const session = await deps.sessions.create(account.id);
    const parsed = validateHandlerResponse(
      AccountSessionResponseSchema,
      {
        account,
        // The RAW session token appears here EXACTLY ONCE.
        session: { token: session.token, expiresAt: session.expiresAt },
      },
      "reckon.api.account-session-response",
    );
    reply.code(201).send(parsed);
  });

  /* ---------------- login (unauthenticated) ---------------- */

  app.post(ACCOUNT_ROUTE_PATHS.login, async (request, reply) => {
    const body = parseRequestBody(LoginRequestSchema, request, "reckon.api.login-request");
    // Unknown email and wrong password are the SAME typed 401 — the
    // response never reveals which part failed.
    const account = await deps.accounts.verifyPassword(body.email, body.password);
    if (account === null) {
      throw sessionUnauthenticated("Invalid email or password");
    }
    const session = await deps.sessions.create(account.id);
    const parsed = validateHandlerResponse(
      AccountSessionResponseSchema,
      {
        account,
        // The RAW session token appears here EXACTLY ONCE.
        session: { token: session.token, expiresAt: session.expiresAt },
      },
      "reckon.api.account-session-response",
    );
    reply.code(200).send(parsed);
  });

  /* ---------------- logout (session-authenticated) ---------------- */

  app.post(
    ACCOUNT_ROUTE_PATHS.logout,
    { preHandler: [accountSessionPreHandler(deps)] },
    async (request, reply) => {
      const { sessionToken } = requireAccountSession(request);
      await deps.sessions.revoke(sessionToken);
      reply.code(204).send();
    },
  );

  /* ---------------- keys: list (session-authenticated) ---------------- */

  app.get(
    ACCOUNT_ROUTE_PATHS.keys,
    { preHandler: [accountSessionPreHandler(deps)] },
    async (request, reply) => {
      const { account } = requireAccountSession(request);
      const stored = await deps.keys.list(account.id);
      // Metadata views only — the schema itself strips any key material.
      const keys = stored.map((view) =>
        validateHandlerResponse(AccountKeySchema, view, "reckon.api.account-key"),
      );
      reply.code(200).send({ keys });
    },
  );

  /* ---------------- keys: mint (session-authenticated) ---------------- */

  app.post(
    ACCOUNT_ROUTE_PATHS.keys,
    { preHandler: [accountSessionPreHandler(deps)] },
    async (request, reply) => {
      const { account } = requireAccountSession(request);
      const body = parseRequestBody(CreateKeyRequestSchema, request, "reckon.api.create-key-request");
      // A self-serve key grants the full route-scope vocabulary (the
      // account owns its tenant); the tier snapshot rides the key row.
      const minted = await deps.keys.mint(account, body, ROUTE_SCOPES);
      const parsed = validateHandlerResponse(
        AccountKeyCreatedSchema,
        { ...minted.view, key: minted.key },
        "reckon.api.account-key-created",
      );
      // The RAW key appears here EXACTLY ONCE (show_once semantics: store
      // it now — later reads return only the metadata view).
      reply.code(201).send(parsed);
    },
  );

  /* ---------------- keys: revoke (session-authenticated) ---------------- */

  app.delete<{ Params: { keyId: string } }>(
    ACCOUNT_ROUTE_PATHS.keyById,
    { preHandler: [accountSessionPreHandler(deps)] },
    async (request, reply) => {
      const { account } = requireAccountSession(request);
      const keyId = request.params.keyId;
      const revoked = await deps.keys.revoke(account.id, keyId);
      if (revoked === null) {
        throw new ApiError(ERROR_CODES.NOT_FOUND, 404, `Account key not found: ${keyId}`, { keyId });
      }
      reply.code(204).send();
    },
  );
}
