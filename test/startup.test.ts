import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "../apps/web/src/instrumentation";
import { logWebStartup } from "../apps/web/src/startup";
import { logWorkerStartup } from "../apps/worker/src/startup";
import { APP_ENVIRONMENTS, readAppEnv, readNodeEnv } from "../packages/shared-types/src/index";

const STARTUP_CASES = [
  ["development", "development"],
  ["integration", "production"],
  ["staging", "production"],
  ["production", "production"],
] as const;

describe("startup hello world", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("treats unset and local as SQLite's app env and rejects a non-Node NODE_ENV", () => {
    expect(APP_ENVIRONMENTS).toEqual(["development", "integration", "staging", "production"]);
    expect(readAppEnv({})).toBe("local");
    expect(readAppEnv({ APP_ENV: "" })).toBe("local");
    expect(readAppEnv({ APP_ENV: "local" })).toBe("local");
    expect(readAppEnv({ APP_ENV: "Staging" })).toBe("staging");
    for (const appEnv of APP_ENVIRONMENTS) {
      expect(readAppEnv({ APP_ENV: appEnv })).toBe(appEnv);
    }
    expect(() => readAppEnv({ APP_ENV: "preview" })).toThrow(/Unknown APP_ENV "preview"/);
    expect(readNodeEnv({})).toBe("");
    expect(readNodeEnv({ NODE_ENV: "test" })).toBe("test");
    expect(() => readNodeEnv({ NODE_ENV: "integration" })).toThrow(/NODE_ENV/);
    expect(() => readNodeEnv({ NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
  });

  it.each(STARTUP_CASES)("web startup prints hello world for %s with NODE_ENV %s", (appEnv, nodeEnv) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(logWebStartup({ APP_ENV: appEnv, NODE_ENV: nodeEnv })).toBe(appEnv);
    expect(log).toHaveBeenCalledWith("hello world");
    expect(log).toHaveBeenCalledWith(`[startup] web APP_ENV=${appEnv} NODE_ENV=${nodeEnv}`);
    expect(() => logWebStartup({ APP_ENV: appEnv, NODE_ENV: "integration" })).toThrow(/NODE_ENV/);
  });

  it.each(STARTUP_CASES)("worker startup prints hello world for %s with NODE_ENV %s", (appEnv, nodeEnv) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(logWorkerStartup({ APP_ENV: appEnv, NODE_ENV: nodeEnv })).toBe(appEnv);
    expect(log).toHaveBeenCalledWith("hello world");
    expect(log).toHaveBeenCalledWith(`[startup] worker APP_ENV=${appEnv} NODE_ENV=${nodeEnv}`);
  });

  it("logs hello world from the Next.js register hook on the nodejs runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("APP_ENV", "staging");
    vi.stubEnv("NODE_ENV", "production");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await register();
    expect(log).toHaveBeenCalledWith("hello world");
    expect(log).toHaveBeenCalledWith("[startup] web APP_ENV=staging NODE_ENV=production");
  });

  it("skips the startup log on the edge runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await register();
    expect(log).not.toHaveBeenCalled();
  });
});
