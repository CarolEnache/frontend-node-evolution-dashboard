import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_ENVIRONMENTS, readAppEnv } from "../packages/shared-types/src/index";
import { register } from "../apps/web/src/instrumentation";
import { logWebStartup } from "../apps/web/src/startup";
import { logWorkerStartup } from "../apps/worker/src/startup";

describe("startup hello world", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("accepts the four FNED-9 environments and defaults to development", () => {
    expect(APP_ENVIRONMENTS).toEqual(["development", "integration", "staging", "production"]);
    expect(readAppEnv({})).toBe("development");
    expect(readAppEnv({ APP_ENV: "" })).toBe("development");
    for (const appEnv of APP_ENVIRONMENTS) {
      expect(readAppEnv({ APP_ENV: appEnv })).toBe(appEnv);
    }
    expect(() => readAppEnv({ APP_ENV: "preview" })).toThrow(/APP_ENV/);
  });

  it.each(APP_ENVIRONMENTS)("web startup prints hello world for %s", (appEnv) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(logWebStartup({ APP_ENV: appEnv, NODE_ENV: appEnv })).toBe(appEnv);
    expect(log).toHaveBeenCalledWith("hello world");
    expect(log).toHaveBeenCalledWith(`[startup] web APP_ENV=${appEnv} NODE_ENV=${appEnv}`);
  });

  it.each(APP_ENVIRONMENTS)("worker startup prints hello world for %s", (appEnv) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(logWorkerStartup({ APP_ENV: appEnv, NODE_ENV: appEnv })).toBe(appEnv);
    expect(log).toHaveBeenCalledWith("hello world");
    expect(log).toHaveBeenCalledWith(`[startup] worker APP_ENV=${appEnv} NODE_ENV=${appEnv}`);
  });

  it("logs hello world from the Next.js register hook on the nodejs runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("APP_ENV", "staging");
    vi.stubEnv("NODE_ENV", "staging");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await register();
    expect(log).toHaveBeenCalledWith("hello world");
    expect(log).toHaveBeenCalledWith("[startup] web APP_ENV=staging NODE_ENV=staging");
  });

  it("skips the startup log on the edge runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await register();
    expect(log).not.toHaveBeenCalled();
  });
});
