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

  it("skips a second read of a feed that never sends ETag or Last-Modified", async () => {
    const body = `<?xml version="1.0"?><rss version="2.0"><channel><item>
      <title>Node.js 26.13.1 (LTS)</title>
      <link>https://nodejs.org/en/blog/release/v26.13.1</link>
      <pubDate>Tue, 10 Nov 2026 00:00:00 GMT</pubDate>
      <description>Security release.</description>
    </item></channel></rss>`;
    const fetchImpl = vi.fn(async () => new Response(body, { status: 200 }));
    const url = "https://nodejs.org/en/feed/releases.xml";
    const first = await fetchIfChanged(url, undefined, { fetchImpl: fetchImpl as typeof fetch });
    expect(first.changed).toBe(true);
    expect(first.etag).toMatch(/^"[0-9a-f]{64}"$/);
    expect(first.lastModified).toBeNull();

    const second = await fetchIfChanged(url, { etag: first.etag, lastModified: first.lastModified }, {
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(second.changed).toBe(false);
    expect(second.status).toBe(200);
    expect(second.body).toBeNull();
    expect(second.etag).toBe(first.etag);

    const nextUrl = "https://nextjs.org/feed.xml";
    const nextFirst = await fetchIfChanged(nextUrl, undefined, { fetchImpl: fetchImpl as typeof fetch });
    const nextSecond = await fetchIfChanged(nextUrl, { etag: nextFirst.etag }, { fetchImpl: fetchImpl as typeof fetch });
    expect(nextSecond.changed).toBe(false);
    expect(nextSecond.etag).toBe(nextFirst.etag);
  });

  it("skips Node.js and Next.js on the second run when their feeds have no validators", async () => {
    const nodeFeed = `<?xml version="1.0"?><rss version="2.0"><channel><item>
      <title>Node.js 22.21.0</title>
      <link>https://nodejs.org/en/blog/release/v22.21.0</link>
      <pubDate>Wed, 28 Oct 2026 00:00:00 GMT</pubDate>
      <description>Current.</description>
    </item></channel></rss>`;
    const nextFeed = `<?xml version="1.0"?><rss version="2.0"><channel><item>
      <title>Next.js 16.4</title>
      <link>https://nextjs.org/blog/next-16-4</link>
      <pubDate>Tue, 28 Oct 2026 00:00:00 GMT</pubDate>
      <description>Release notes.</description>
    </item></channel></rss>`;
    const bodies: Record<string, { body: string; etag?: string }> = {
      [SOURCE_URLS.nodeIndex]: {
        body: JSON.stringify([{ version: "v22.21.0", date: "2026-10-28", lts: false }]),
        etag: '"node-index"',
      },
      [SOURCE_URLS.nodeSchedule]: { body: "{}", etag: '"node-schedule"' },
      [SOURCE_URLS.nodeRss]: { body: nodeFeed },
      [SOURCE_URLS.nextLatest]: {
        body: JSON.stringify({
          tag_name: "v16.4.3",
          name: "Next.js 16.4.3",
          draft: false,
          prerelease: false,
          published_at: "2026-10-28T00:00:00.000Z",
          html_url: "https://github.com/vercel/next.js/releases/tag/v16.4.3",
        }),
        etag: '"next-latest"',
      },
      [SOURCE_URLS.nextReleases]: { body: "[]", etag: '"next-list"' },
      [SOURCE_URLS.nextFeed]: { body: nextFeed },
    };
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const route = bodies[url];
      if (!route) return new Response("missing", { status: 404 });
      const headers = new Headers(init?.headers);
      if (route.etag && headers.get("if-none-match") === route.etag) {
        return new Response(null, { status: 304, headers: { etag: route.etag } });
      }
      return new Response(route.body, {
        status: 200,
        headers: route.etag ? { etag: route.etag } : {},
      });
    });
    const nodeFirst = await ingestSource("node", { fetchImpl: fetchImpl as typeof fetch });
    expect(nodeFirst.skipped).toBe(false);
    expect(nodeFirst.states.find((state) => state.url === SOURCE_URLS.nodeRss)?.etag).toMatch(/^"[0-9a-f]{64}"$/);
    const nodeSecond = await ingestSource("node", {
      fetchImpl: fetchImpl as typeof fetch,
      states: nodeFirst.states,
    });
    expect(nodeSecond.skipped).toBe(true);
    expect(nodeSecond.entries).toEqual([]);

    const nextFirst = await ingestSource("nextjs", { fetchImpl: fetchImpl as typeof fetch });
    expect(nextFirst.skipped).toBe(false);
    expect(nextFirst.states.find((state) => state.url === SOURCE_URLS.nextFeed)?.etag).toMatch(/^"[0-9a-f]{64}"$/);
    const nextSecond = await ingestSource("nextjs", {
      fetchImpl: fetchImpl as typeof fetch,
      states: nextFirst.states,
    });
    expect(nextSecond.skipped).toBe(true);
    expect(nextSecond.entries).toEqual([]);
  });
});
