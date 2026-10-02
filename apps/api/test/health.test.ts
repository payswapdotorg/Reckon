import { describe, it, expect, afterEach } from "vitest";
import { CONTRACTS_VERSION } from "@reckon/contracts";
import { buildDefaultServer, buildStubServer, injectJson } from "./fixtures.js";
import type { FastifyInstance } from "fastify";

describe("GET /healthz", () => {
  it("returns ok with API version and contracts version, no auth required", async () => {
    const app = buildDefaultServer();
    try {
      const res = await injectJson(app, "GET", "/healthz", {});
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, version: "0.1.0", contractsVersion: CONTRACTS_VERSION });
    } finally {
      await app.close();
    }
  });

  it("ignores a bogus Authorization header (never authenticated)", async () => {
    const app = buildDefaultServer();
    try {
      const res = await injectJson(app, "GET", "/healthz", {
        headers: { authorization: "Bearer not-a-key" },
      });
      expect(res.status).toBe(200);
      expect((res.body as { ok?: boolean }).ok).toBe(true);
    } finally {
      await app.close();
    }
  });
});

describe("GET /readyz", () => {
  const PORT_NAMES = [
    "decisionHandler",
    "decisionStore",
    "outcomeIngest",
    "preferenceIngest",
    "planHandler",
    "catalogItemIngest",
    "realizationIngest",
    "candidatesHandler",
    "experienceResolver",
    "agentHandler",
    "researchHandler",
  ];

  it("default server reports every handler port as not-wired", async () => {
    const app = buildDefaultServer();
    try {
      const res = await injectJson(app, "GET", "/readyz", {});
      expect(res.status).toBe(200);
      const body = res.body as { ok?: boolean; handlers?: Record<string, string> };
      expect(body.ok).toBe(true);
      expect(Object.keys(body.handlers ?? {}).sort()).toEqual([...PORT_NAMES].sort());
      for (const port of Object.values(body.handlers ?? {})) {
        expect(port).toBe("not-wired");
      }
    } finally {
      await app.close();
    }
  });

  it("stub server reports every handler port as wired", async () => {
    const { app } = buildStubServer();
    try {
      const res = await injectJson(app, "GET", "/readyz", {});
      expect(res.status).toBe(200);
      const body = res.body as { handlers?: Record<string, string> };
      for (const port of Object.values(body.handlers ?? {})) {
        expect(port).toBe("wired");
      }
    } finally {
      await app.close();
    }
  });

  it("partially-wired server reports exactly the mounted ports as wired", async () => {
    const { buildServer } = await import("../src/server.js");
    const { testConfig } = await import("./fixtures.js");
    const app: FastifyInstance = buildServer(
      testConfig({
        handlers: {
          outcomeIngest: { ingest: async (event: never) => event },
          decisionStore: { get: async () => null },
        },
      }),
    );
    try {
      const res = await injectJson(app, "GET", "/readyz", {});
      const body = res.body as { handlers?: Record<string, string> };
      expect(body.handlers?.outcomeIngest).toBe("wired");
      expect(body.handlers?.decisionStore).toBe("wired");
      expect(body.handlers?.decisionHandler).toBe("not-wired");
      expect(body.handlers?.planHandler).toBe("not-wired");
    } finally {
      await app.close();
    }
  });
});
