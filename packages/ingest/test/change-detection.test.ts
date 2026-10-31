import { describe, expect, it, vi } from "vitest";
import { conditionalHeaders, fetchIfChanged } from "../src/fetch-if-changed";
import { ingestSource } from "../src/index";
import { SOURCE_URLS } from "../src/sources/types";

describe("conditional requests", () => {
  it("sends validators and a GitHub token only for the GitHub API", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200, headers: { etag: '"v2"' } }));
    const headers = conditionalHeaders(
      "https://api.github.com/repos/vercel/next.js/releases/latest",
      { etag: '"v1"', lastModified: "Wed, 21 Oct 2015 07:28:00 GMT" },
      { githubToken: "test-token" },
    );
    expect(headers["if-none-match"]).toBe('"v1"');
    expect(headers["if-modified-since"]).toBe("Wed, 21 Oct 2015 07:28:00 GMT");
    expect(headers.authorization).toBe("Bearer test-token");
    expect(headers.accept).toBe("application/vnd.github+json");

    const result = await fetchIfChanged("https://example.com/data.json", undefined, {
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result.changed).toBe(true);
    expect(result.etag).toBe('"v2"');
    expect(conditionalHeaders("https://registry.npmjs.org/typescript").accept).toBe(
      "application/vnd.npm.install-v1+json",
    );
  });

  it("treats 304 as unchanged and keeps the previous validators", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (headers.get("if-none-match") === '"same"') {
        return new Response(null, { status: 304 });
      }
      return new Response("body", { status: 200, headers: { etag: '"same"' } });
    });
    const first = await fetchIfChanged("https://nodejs.org/dist/index.json", undefined, {
      fetchImpl: fetchImpl as typeof fetch,
    });
    const second = await fetchIfChanged(
      "https://nodejs.org/dist/index.json",
      { etag: first.etag },
      { fetchImpl: fetchImpl as typeof fetch },
    );
    expect(second.changed).toBe(false);
    expect(second.status).toBe(304);
    expect(second.body).toBeNull();
    expect(second.etag).toBe('"same"');
  });

  it("skips the BCD payload when the npm version has not changed", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      if (url === SOURCE_URLS.mdnMeta) {
        return new Response(JSON.stringify({ version: "8.1.7" }), {
          status: 200,
          headers: { etag: '"meta"' },
        });
      }
      return new Response("unexpected", { status: 500 });
    });
    const result = await ingestSource("mdn-bcd", {
      fetchImpl: fetchImpl as typeof fetch,
      states: [
        {
          source: "mdn-bcd",
          url: SOURCE_URLS.mdnMeta,
          version: "8.1.7",
          etag: '"old"',
        },
      ],
    });
    expect(result.skipped).toBe(true);
    expect(result.entries).toEqual([]);
    expect(calls).toEqual([SOURCE_URLS.mdnMeta]);
    expect(result.states[0]?.version).toBe("8.1.7");
  });
});
