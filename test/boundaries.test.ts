import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("web bundle boundaries", () => {
  it("keeps transformers, ingestion, and the AI package out of the web app", () => {
    const pkg = JSON.parse(readFileSync(new URL("../apps/web/package.json", import.meta.url), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const names = Object.keys(pkg.dependencies ?? {});
    expect(names).not.toContain("@evolution/ai");
    expect(names).not.toContain("@evolution/ingest");
    expect(names).not.toContain("@huggingface/transformers");
    expect(names).not.toContain("@huggingface/inference");
    const config = readFileSync(new URL("../apps/web/next.config.ts", import.meta.url), "utf8");
    expect(config).toContain("transpilePackages");
    expect(config).toContain("serverExternalPackages");
    expect(config).toContain("turbopack");
    expect(config).not.toContain("webpack:");
    expect(config).not.toContain("--webpack");
  });
});
