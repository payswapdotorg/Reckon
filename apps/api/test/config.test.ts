/**
 * P1-004 — parseListenConfig: env separation with fail-fast port
 * validation. No server boot needed; pure config surface.
 */
import { describe, expect, it } from "vitest";
import { parseListenConfig } from "../src/config.js";
import { ConfigError } from "../src/errors.js";

describe("parseListenConfig (production entrypoint env)", () => {
  it("defaults: loopback host, port 8080 when nothing is set", () => {
    expect(parseListenConfig({})).toEqual({ host: "127.0.0.1", port: 8080 });
    expect(parseListenConfig({ RECKON_PORT: "", RECKON_HOST: "" })).toEqual({ host: "127.0.0.1", port: 8080 });
  });

  it("accepts explicit host + valid ports (boundaries included)", () => {
    expect(parseListenConfig({ RECKON_HOST: "0.0.0.0", RECKON_PORT: "1" })).toEqual({
      host: "0.0.0.0",
      port: 1,
    });
    expect(parseListenConfig({ RECKON_PORT: "65535" })).toEqual({ host: "127.0.0.1", port: 65535 });
    expect(parseListenConfig({ RECKON_PORT: "3000" })).toEqual({ host: "127.0.0.1", port: 3000 });
  });

  it("rejects non-integer ports with an honest ConfigError naming the variable", () => {
    for (const bad of ["abc", "80.5", "-1", "0x50", " 80", "80 "]) {
      expect(() => parseListenConfig({ RECKON_PORT: bad })).toThrowError(ConfigError);
      expect(() => parseListenConfig({ RECKON_PORT: bad })).toThrowError(/RECKON_PORT/);
    }
  });

  it("rejects out-of-range integer ports (0, 65536, 100000)", () => {
    for (const bad of ["0", "65536", "100000"]) {
      expect(() => parseListenConfig({ RECKON_PORT: bad })).toThrowError(/1\.\.65535/);
    }
  });
});
