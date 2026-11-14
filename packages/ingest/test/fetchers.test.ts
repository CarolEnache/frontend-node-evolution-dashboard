import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Source, SourceState } from "@evolution/shared-types";
import { describe, expect, it, vi } from "vitest";
import { fetchBackoffMs, fetchIfChanged } from "../src/fetch-if-changed";
import { fixture } from "../../../test/fixture";
import { mockFetch, notModified, type FetchRoute } from "../../../test/mock-fetch";
import { ingestAll, ingestSource } from "../src/index";
import { SOURCE_URLS, type IngestContext } from "../src/sources/types";

const NOW = () => new Date("2026-10-31T12:00:00.000Z");
const LAST_MODIFIED = "Fri, 31 Oct 2026 00:00:00 GMT";
const noopSleep = async () => {};

const unchanged = notModified();

function requestHeaders(init?: RequestInit): Headers {
  return new Headers(init?.headers);
}

function ok(body: string, etag: string): Response {
  return new Response(body, {
    status: 200,
    headers: { etag, "last-modified": LAST_MODIFIED },
  });
}

interface Route {
  body: string;
  etag: string;
}

function conditionalFetch(routes: Record<string, Route>, options?: { requireModifiedSince?: boolean }) {
  const calls: string[] = [];
  const authorizations: Array<string | null> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(url);
    const headers = requestHeaders(init);
    if (url.includes("api.github.com")) authorizations.push(headers.get("authorization"));
    const route = routes[url];
    if (!route) return new Response(`missing ${url}`, { status: 404 });
    const validatorsMatch = headers.get("if-none-match") === route.etag;
    const modifiedSinceOk = !options?.requireModifiedSince || headers.get("if-modified-since") === LAST_MODIFIED;
    if (validatorsMatch && modifiedSinceOk) {
      return new Response(null, { status: 304, headers: { etag: route.etag } });
    }
    return ok(route.body, route.etag);
  });
  return { fetchImpl: fetchImpl as typeof fetch, calls, authorizations };
}

function remembered(source: Source, url: string, etag: string, version?: string): SourceState {
  return {
    source,
    url,
    etag,
    lastModified: LAST_MODIFIED,
    version: version ?? null,
    lastFetchedAt: "2026-10-01T00:00:00.000Z",
    lastSuccessAt: "2026-10-01T00:00:00.000Z",
  };
}

const emptyFeed = `<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>`;

const mdnVersion = "8.2.0";
const mdnRoutes: Record<string, Route> = {
  [SOURCE_URLS.mdnMeta]: { body: JSON.stringify({ version: mdnVersion }), etag: '"mdn-meta"' },
  [SOURCE_URLS.mdnRelease]: {
    etag: '"mdn-release"',
    body: JSON.stringify({
      tag_name: "v8.2.0",
      name: "browser-compat-data 8.2.0",
      draft: false,
      prerelease: false,
      published_at: "2026-10-22T00:00:00.000Z",
      html_url: "https://github.com/mdn/browser-compat-data/releases/tag/v8.2.0",
      body: "## Additions\n- `api.Foo`\n",
    }),
  },
  [SOURCE_URLS.mdnData(mdnVersion)]: {
    etag: '"mdn-data"',
    body: JSON.stringify({
      api: { Foo: { __compat: { support: { chrome: { version_added: "120" } } } } },
    }),
  },
};

const caniuseVersion = "1.0.30001820";
const caniusePrevious = "1.0.30001819";
const caniuseRoutes: Record<string, Route> = {
  [SOURCE_URLS.caniuseMeta]: { body: JSON.stringify({ version: caniuseVersion }), etag: '"caniuse-meta"' },
  [SOURCE_URLS.caniuseData(caniusePrevious)]: { body: JSON.stringify({ data: {} }), etag: '"caniuse-prev"' },
  [SOURCE_URLS.caniuseData(caniuseVersion)]: {
    etag: '"caniuse-data"',
    body: JSON.stringify({
      updated: 1761600000,
      data: {
        "anchor-positioning": {
          title: "Anchor positioning",
          description: "CSS anchor positioning.",
          categories: ["CSS"],
        },
      },
    }),
  },
};

const nodeRoutes: Record<string, Route> = {
  [SOURCE_URLS.nodeIndex]: {
    etag: '"node-index"',
    body: JSON.stringify([
      { version: "v22.21.0", date: "2026-10-28", lts: false, security: false, npm: "10.9.4", v8: "12.4.0" },
    ]),
  },
  [SOURCE_URLS.nodeSchedule]: { body: JSON.stringify({}), etag: '"node-schedule"' },
  [SOURCE_URLS.nodeRss]: { body: emptyFeed, etag: '"node-feed"' },
};

const typescriptRoutes: Record<string, Route> = {
  [SOURCE_URLS.tsMeta]: {
    etag: '"ts-meta"',
    body: JSON.stringify({
      "dist-tags": { latest: "5.9.3", beta: "5.10.0-beta", next: "5.10.0-dev.20261031.1" },
      time: { "5.9.3": "2026-10-20T00:00:00.000Z", "5.10.0-beta": "2026-10-29T00:00:00.000Z" },
    }),
  },
  [SOURCE_URLS.tsReleases]: {
    etag: '"ts-releases"',
    body: JSON.stringify([
      {
        tag_name: "v5.9.3",
        name: "TypeScript 5.9.3",
        draft: false,
        prerelease: false,
        body: "Stable changelog.",
        published_at: "2026-10-20T00:00:00.000Z",
        html_url: "https://github.com/microsoft/TypeScript/releases/tag/v5.9.3",
      },
    ]),
  },
  [SOURCE_URLS.tsFeed]: {
    etag: '"ts-feed"',
    body: `<?xml version="1.0"?><rss version="2.0"><channel><item>
      <title>Announcing TypeScript 5.9</title>
      <link>https://devblogs.microsoft.com/typescript/announcing-typescript-5-9/</link>
      <pubDate>Mon, 20 Oct 2026 00:00:00 GMT</pubDate>
      <description>Release announcement.</description>
    </item></channel></rss>`,
  },
};

const nextRoutes: Record<string, Route> = {
  [SOURCE_URLS.nextLatest]: {
    etag: '"next-latest"',
    body: JSON.stringify({
      tag_name: "v16.4.3",
      name: "Next.js 16.4.3",
      draft: false,
      prerelease: false,
      body: "Stable release.",
      published_at: "2026-10-28T00:00:00.000Z",
      html_url: "https://github.com/vercel/next.js/releases/tag/v16.4.3",
    }),
  },
  [SOURCE_URLS.nextReleases]: {
    etag: '"next-list"',
    body: JSON.stringify([
      {
        tag_name: "v16.5.0-canary.35",
        prerelease: true,
        draft: false,
        published_at: "2026-10-30T00:00:00.000Z",
        html_url: "https://github.com/vercel/next.js/releases/tag/v16.5.0-canary.35",
      },
      {
        tag_name: "v16.4.3",
        name: "Next.js 16.4.3",
        draft: false,
        prerelease: false,
        body: "Stable release.",
        published_at: "2026-10-28T00:00:00.000Z",
        html_url: "https://github.com/vercel/next.js/releases/tag/v16.4.3",
      },
    ]),
  },
  [SOURCE_URLS.nextFeed]: {
    etag: '"next-feed"',
    body: `<?xml version="1.0"?><rss version="2.0"><channel><item>
      <title>Next.js 16.4</title>
      <link>https://nextjs.org/blog/next-16-4</link>
      <pubDate>Tue, 28 Oct 2026 00:00:00 GMT</pubDate>
      <description>Release notes.</description>
    </item></channel></rss>`,
  },
};

describe("conditional fetch retries", () => {
  it("retries 429 and 503 with backoff, then returns the 200 body", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return new Response("slow", { status: 429 });
      if (calls === 2) return new Response("down", { status: 503 });
      return ok("payload", '"done"');
    });
    const result = await fetchIfChanged("https://example.com/data.json", undefined, {
      fetchImpl: fetchImpl as typeof fetch,
      maxAttempts: 3,
      random: () => 0,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(calls).toBe(3);
    expect(sleeps).toEqual([fetchBackoffMs(0, 0), fetchBackoffMs(1, 0)]);
    expect(result.changed).toBe(true);
    expect(result.body).toBe("payload");
    expect(result.etag).toBe('"done"');
  });

  it("does not retry a 404", async () => {
    const fetchImpl = vi.fn(async () => new Response("missing", { status: 404 }));
    await expect(
      fetchIfChanged("https://example.com/missing", undefined, {
        fetchImpl: fetchImpl as typeof fetch,
        maxAttempts: 3,
        sleep: async () => {
          throw new Error("should not sleep");
        },
      }),
    ).rejects.toThrow("GET https://example.com/missing failed with 404");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("aborts a hung request at the timeout and retries", async () => {
    const sleeps: number[] = [];
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("expected an abort signal"));
          return;
        }
        signal.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted", "AbortError"));
        });
      });
    });
    await expect(
      fetchIfChanged("https://example.com/slow", undefined, {
        fetchImpl: fetchImpl as typeof fetch,
        timeoutMs: 20,
        maxAttempts: 2,
        random: () => 0,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      }),
    ).rejects.toThrow("GET https://example.com/slow timed out after 20ms");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([fetchBackoffMs(0, 0)]);
  });

  it("aborts a stalled response body at the timeout", async () => {
    vi.unstubAllGlobals();
    const server = createServer((_request, response) => {
      response.writeHead(200, { etag: '"stalled"' });
      response.write("partial");
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}/stall`;
    try {
      const error = await Promise.race([
        fetchIfChanged(url, undefined, { timeoutMs: 50, maxAttempts: 1, fetchImpl: fetch }).then(
          () => new Error("request resolved"),
          (caught: unknown) => (caught instanceof Error ? caught : new Error(String(caught))),
        ),
        new Promise<Error>((resolve) => {
          setTimeout(() => resolve(new Error("body read was not bounded by the timeout")), 500);
        }),
      ]);
      expect(error.message).toBe(`GET ${url} timed out after 50ms`);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });
});

describe("MDN browser-compat-data fetcher", () => {
  it("normalises a 200 into a release and addition entries and stores validators", async () => {
    const { fetchImpl, calls } = conditionalFetch(mdnRoutes);
    const result = await ingestSource("mdn-bcd", { fetchImpl, now: NOW });
    expect(result.skipped).toBe(false);
    expect(result.entries.map((entry) => entry.id).sort()).toEqual([
      "mdn-bcd:feature:api.Foo",
      "mdn-bcd:release:8.2.0",
    ]);
    expect(result.entries.every((entry) => entry.source === "mdn-bcd")).toBe(true);
    expect(result.states.map((state) => state.etag)).toEqual(['"mdn-meta"', '"mdn-release"', '"mdn-data"']);
    expect(calls).toEqual([SOURCE_URLS.mdnMeta, SOURCE_URLS.mdnRelease, SOURCE_URLS.mdnData(mdnVersion)]);
  });

  it("skips work on 304 and keeps the stored validators", async () => {
    const { fetchImpl, calls } = conditionalFetch(mdnRoutes);
    const result = await ingestSource("mdn-bcd", {
      fetchImpl,
      now: NOW,
      states: [remembered("mdn-bcd", SOURCE_URLS.mdnMeta, '"mdn-meta"', mdnVersion)],
    });
    expect(result.skipped).toBe(true);
    expect(result.entries).toEqual([]);
    expect(calls).toEqual([SOURCE_URLS.mdnMeta]);
    expect(result.states[0]?.etag).toBe('"mdn-meta"');
    expect(result.states[0]?.version).toBe(mdnVersion);
    expect(result.states[0]?.lastSuccessAt).toBe("2026-10-31T12:00:00.000Z");
  });

  it("fails this source when the metadata request errors", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));
    await expect(
      ingestSource("mdn-bcd", { fetchImpl: fetchImpl as typeof fetch, maxAttempts: 1, sleep: noopSleep, now: NOW }),
    ).rejects.toThrow(`GET ${SOURCE_URLS.mdnMeta} failed with 500`);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("Can I Use fetcher", () => {
  it("normalises a 200 into a release and a new feature", async () => {
    const { fetchImpl } = conditionalFetch(caniuseRoutes);
    const result = await ingestSource("caniuse", {
      fetchImpl,
      now: NOW,
      states: [remembered("caniuse", SOURCE_URLS.caniuseMeta, '"old-meta"', caniusePrevious)],
    });
    expect(result.skipped).toBe(false);
    expect(result.entries.map((entry) => entry.id).sort()).toEqual([
      "caniuse:feature:anchor-positioning",
      `caniuse:release:${caniuseVersion}`,
    ]);
    expect(result.states.find((state) => state.url === SOURCE_URLS.caniuseMeta)?.version).toBe(caniuseVersion);
    expect(result.states.find((state) => state.url === SOURCE_URLS.caniuseMeta)?.etag).toBe('"caniuse-meta"');
  });

  it("skips work on 304 and keeps the stored validators", async () => {
    const { fetchImpl, calls } = conditionalFetch(caniuseRoutes);
    const result = await ingestSource("caniuse", {
      fetchImpl,
      now: NOW,
      states: [remembered("caniuse", SOURCE_URLS.caniuseMeta, '"caniuse-meta"', caniuseVersion)],
    });
    expect(result.skipped).toBe(true);
    expect(result.entries).toEqual([]);
    expect(calls).toEqual([SOURCE_URLS.caniuseMeta]);
    expect(result.states[0]?.etag).toBe('"caniuse-meta"');
  });

  it("fails this source when the metadata request errors", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 502 }));
    await expect(
      ingestSource("caniuse", { fetchImpl: fetchImpl as typeof fetch, maxAttempts: 1, sleep: noopSleep }),
    ).rejects.toThrow(`GET ${SOURCE_URLS.caniuseMeta} failed with 502`);
  });
});

describe("Node.js releases fetcher", () => {
  it("normalises a 200 from the dist index", async () => {
    const { fetchImpl, calls } = conditionalFetch(nodeRoutes);
    const result = await ingestSource("node", { fetchImpl, now: NOW });
    expect(result.skipped).toBe(false);
    expect(result.entries.map((entry) => entry.id)).toEqual(["node:release:22.21.0"]);
    expect(result.entries[0]?.title).toContain("Node.js");
    expect(result.states.map((state) => state.url)).toEqual([
      SOURCE_URLS.nodeIndex,
      SOURCE_URLS.nodeSchedule,
      SOURCE_URLS.nodeRss,
    ]);
    expect(result.states[0]?.etag).toBe('"node-index"');
    expect(result.states[0]?.version).toBe("v22.21.0");
    expect(calls).toEqual([SOURCE_URLS.nodeIndex, SOURCE_URLS.nodeSchedule, SOURCE_URLS.nodeRss]);
  });

  it("skips work on 304 when every validator matches", async () => {
    const { fetchImpl, calls } = conditionalFetch(nodeRoutes, { requireModifiedSince: true });
    const result = await ingestSource("node", {
      fetchImpl,
      now: NOW,
      states: [
        remembered("node", SOURCE_URLS.nodeIndex, '"node-index"', "v22.21.0"),
        remembered("node", SOURCE_URLS.nodeSchedule, '"node-schedule"'),
        remembered("node", SOURCE_URLS.nodeRss, '"node-feed"'),
      ],
    });
    expect(result.skipped).toBe(true);
    expect(result.entries).toEqual([]);
    expect(calls).toHaveLength(3);
    expect(result.states.map((state) => state.etag)).toEqual(['"node-index"', '"node-schedule"', '"node-feed"']);
  });

  it("fails this source when the dist index errors", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 503 }));
    await expect(
      ingestSource("node", { fetchImpl: fetchImpl as typeof fetch, maxAttempts: 1, sleep: noopSleep }),
    ).rejects.toThrow(`GET ${SOURCE_URLS.nodeIndex} failed with 503`);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("TypeScript changelog fetcher", () => {
  it("normalises a 200 from dist-tags, GitHub releases, and the devblog without a token", async () => {
    const { fetchImpl, authorizations } = conditionalFetch(typescriptRoutes);
    const result = await ingestSource("typescript", { fetchImpl, now: NOW });
    expect(authorizations).toEqual([null]);
    expect(result.skipped).toBe(false);
    expect(result.entries.map((entry) => entry.id).sort()).toEqual([
      "typescript:article:announcing-typescript-5-9",
      "typescript:release:5.10.0-beta",
      "typescript:release:5.9.3",
    ]);
    expect(result.entries.some((entry) => entry.version?.includes("-dev."))).toBe(false);
    expect(result.states.map((state) => state.etag)).toEqual(['"ts-meta"', '"ts-releases"', '"ts-feed"']);
  });

  it("sends a bearer token only when GITHUB_TOKEN is provided", async () => {
    const { fetchImpl, authorizations } = conditionalFetch(typescriptRoutes);
    await ingestSource("typescript", { fetchImpl, githubToken: "gh_test", now: NOW });
    expect(authorizations).toEqual(["Bearer gh_test"]);
  });

  it("skips work on 304 and keeps the stored validators", async () => {
    const { fetchImpl } = conditionalFetch(typescriptRoutes);
    const result = await ingestSource("typescript", {
      fetchImpl,
      now: NOW,
      states: [
        remembered("typescript", SOURCE_URLS.tsMeta, '"ts-meta"', "5.9.3"),
        remembered("typescript", SOURCE_URLS.tsReleases, '"ts-releases"', "5.9.3"),
        remembered("typescript", SOURCE_URLS.tsFeed, '"ts-feed"'),
      ],
    });
    expect(result.skipped).toBe(true);
    expect(result.entries).toEqual([]);
    expect(result.states.map((state) => state.etag)).toEqual(['"ts-meta"', '"ts-releases"', '"ts-feed"']);
    expect(result.states[0]?.version).toBe("5.9.3");
  });

  it("fails this source when the packument request errors", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));
    await expect(
      ingestSource("typescript", { fetchImpl: fetchImpl as typeof fetch, maxAttempts: 1, sleep: noopSleep }),
    ).rejects.toThrow(`GET ${SOURCE_URLS.tsMeta} failed with 500`);
  });
});

describe("Next.js releases fetcher", () => {
  it("normalises a 200 and drops canaries", async () => {
    const { fetchImpl, authorizations } = conditionalFetch(nextRoutes);
    const result = await ingestSource("nextjs", { fetchImpl, now: NOW });
    expect(authorizations).toEqual([null, null]);
    expect(result.skipped).toBe(false);
    expect(result.entries.map((entry) => entry.id).sort()).toEqual([
      "nextjs:article:next-js-16-4",
      "nextjs:release:16.4.3",
    ]);
    expect(result.entries.some((entry) => entry.version?.includes("canary"))).toBe(false);
    expect(result.states.map((state) => state.etag)).toEqual(['"next-latest"', '"next-list"', '"next-feed"']);
  });

  it("skips work on 304 and keeps the stored validators", async () => {
    const { fetchImpl } = conditionalFetch(nextRoutes);
    const result = await ingestSource("nextjs", {
      fetchImpl,
      now: NOW,
      states: [
        remembered("nextjs", SOURCE_URLS.nextLatest, '"next-latest"', "16.4.3"),
        remembered("nextjs", SOURCE_URLS.nextReleases, '"next-list"', "16.4.3"),
        remembered("nextjs", SOURCE_URLS.nextFeed, '"next-feed"'),
      ],
    });
    expect(result.skipped).toBe(true);
    expect(result.entries).toEqual([]);
    expect(result.states.map((state) => state.etag)).toEqual(['"next-latest"', '"next-list"', '"next-feed"']);
  });

  it("fails this source when the latest-release request errors", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 429 }));
    await expect(
      ingestSource("nextjs", { fetchImpl: fetchImpl as typeof fetch, maxAttempts: 1, sleep: noopSleep }),
    ).rejects.toThrow(`GET ${SOURCE_URLS.nextLatest} failed with 429`);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("FNED-5 regressions", () => {
  it("keeps Can I Use and MDN feature and support-change ids unique inside one dataset version", async () => {
    const caniuse = conditionalFetch({
      [SOURCE_URLS.caniuseMeta]: { body: JSON.stringify({ version: "1.0.30001821" }), etag: '"caniuse-meta"' },
      [SOURCE_URLS.caniuseData("1.0.30001820")]: {
        etag: '"caniuse-prev"',
        body: JSON.stringify({
          updated: 1793059200,
          data: {
            "css-grid": {
              title: "CSS Grid",
              description: "Grid layout.",
              categories: ["CSS"],
              stats: { firefox: { "119": "p", "120": "n", "121": "y" } },
            },
          },
        }),
      },
      [SOURCE_URLS.caniuseData("1.0.30001821")]: {
        etag: '"caniuse-next"',
        body: JSON.stringify({
          updated: 1793145600,
          data: {
            "css-grid": {
              title: "CSS Grid",
              description: "Grid layout.",
              categories: ["CSS"],
              stats: { firefox: { "119": "n", "120": "a", "121": "y", "122": "y" } },
            },
            "anchor-positioning": {
              title: "Anchor positioning",
              description: "CSS anchor positioning.",
              categories: ["CSS"],
            },
            "unnamed-feature": { categories: ["JS"] },
          },
        }),
      },
    });
    const caniuseResult = await ingestSource("caniuse", {
      fetchImpl: caniuse.fetchImpl,
      now: NOW,
      states: [remembered("caniuse", SOURCE_URLS.caniuseMeta, '"old"', "1.0.30001820")],
    });
    expect(caniuseResult.entries.map((entry) => entry.id).sort()).toEqual([
      "caniuse:feature:anchor-positioning",
      "caniuse:feature:unnamed-feature",
      "caniuse:release:1.0.30001821",
      "caniuse:support-change:css-grid:firefox:120",
    ]);

    const mdn = conditionalFetch({
      [SOURCE_URLS.mdnMeta]: { body: JSON.stringify({ version: "8.1.7" }), etag: '"mdn-meta"' },
      [SOURCE_URLS.mdnRelease]: {
        etag: '"mdn-release"',
        body: JSON.stringify({
          tag_name: "v8.1.7",
          name: "v8.1.7",
          published_at: "2026-10-22T00:00:00.000Z",
          html_url: "https://github.com/mdn/browser-compat-data/releases/tag/v8.1.7",
          body: "## Statistics\n- 2 additions\n\n## Additions\n- `api.CSSAnchorPositioning`\n- css.properties.overflow-clip-margin\n\n## Removals\n- api.DeprecatedThing\n",
        }),
      },
      [SOURCE_URLS.mdnReleases]: {
        etag: '"mdn-releases"',
        body: JSON.stringify({
          tag_name: "v8.1.7",
          published_at: "2026-10-22T00:00:00.000Z",
          html_url: "https://github.com/mdn/browser-compat-data/releases/tag/v8.1.7",
          body: "## Statistics\n- 2 additions\n\n## Additions\n- `api.CSSAnchorPositioning`\n- css.properties.overflow-clip-margin\n\n## Removals\n- api.DeprecatedThing\n",
        }),
      },
      [SOURCE_URLS.mdnData("8.1.6")]: {
        etag: '"mdn-prev"',
        body: JSON.stringify({
          css: {
            properties: {
              "overflow-clip-margin": {
                __compat: {
                  support: { firefox: { version_added: false }, chrome: { version_added: true } },
                  status: { experimental: false },
                },
              },
            },
          },
        }),
      },
      [SOURCE_URLS.mdnData("8.1.7")]: {
        etag: '"mdn-next"',
        body: JSON.stringify({
          css: {
            properties: {
              "overflow-clip-margin": {
                __compat: {
                  support: {
                    firefox: [{ version_added: "145" }, { version_added: false }],
                    chrome: { version_added: "100" },
                  },
                },
              },
              "reading-order": {
                __compat: { support: { chrome: { version_added: "140" } } },
              },
            },
          },
        }),
      },
    });
    const mdnResult = await ingestSource("mdn-bcd", {
      fetchImpl: mdn.fetchImpl,
      now: NOW,
      states: [remembered("mdn-bcd", SOURCE_URLS.mdnMeta, '"old"', "8.1.6")],
    });
    expect(mdnResult.entries.map((entry) => entry.id).sort()).toEqual([
      "mdn-bcd:feature:api.CSSAnchorPositioning",
      "mdn-bcd:feature:css.properties.overflow-clip-margin",
      "mdn-bcd:feature:css.properties.reading-order",
      "mdn-bcd:release:8.1.7",
      "mdn-bcd:support-change:css.properties.overflow-clip-margin:firefox:145",
    ]);
  });

  it("rejects a null or non-object TypeScript packument as validation, not a TypeError", async () => {
    for (const body of ["null", "1", "\"nope\""]) {
      const fetchImpl = vi.fn(async (url: string) => {
        if (url === SOURCE_URLS.tsMeta) return new Response(body, { status: 200 });
        if (url === SOURCE_URLS.tsReleases) return new Response("[]", { status: 200 });
        return new Response(`<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>`, { status: 200 });
      });
      await expect(
        ingestSource("typescript", { fetchImpl: fetchImpl as typeof fetch, maxAttempts: 1, sleep: noopSleep, now: NOW }),
      ).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(TypeError);
        expect((error as Error).message).toMatch(/must be an object/);
        return true;
      });
    }
  });
});

// Retry timing is covered by the conditional-fetch tests. These fixtures assert one failed response.
function ctx(routes: Record<string, FetchRoute | FetchRoute[]>, states?: SourceState[]): IngestContext {
  return { fetchImpl: mockFetch(routes), now: NOW, states, maxAttempts: 1, sleep: noopSleep };
}

describe("source fetchers", () => {
  it("diffs Can I Use releases, new features, and support flips", async () => {
    const result = await ingestSource(
      "caniuse",
      ctx(
        {
          [SOURCE_URLS.caniuseMeta]: fixture("caniuse/meta-1821.json"),
          [SOURCE_URLS.caniuseData("1.0.30001821")]: fixture("caniuse/data-1821.json"),
          [SOURCE_URLS.caniuseData("1.0.30001820")]: fixture("caniuse/data-1820.json"),
        },
        [{ source: "caniuse", url: SOURCE_URLS.caniuseMeta, version: "1.0.30001820", etag: '"old"' }],
      ),
    );
    expect(result.skipped).toBe(false);
    expect(result.entries.map((entry) => entry.id).sort()).toEqual([
      "caniuse:feature:anchor-positioning",
      "caniuse:feature:unnamed-feature",
      "caniuse:release:1.0.30001821",
      "caniuse:support-change:css-grid:firefox:120",
    ]);
    expect(result.entries.find((entry) => entry.type === "release")?.id).toBe("caniuse:release:1.0.30001821");
    const support = result.entries.find((entry) => entry.type === "support-change");
    expect(support?.summary).toContain('"n"');
    expect(support?.summary).toContain('"a"');
    expect(support?.title).toContain("firefox 120");
    expect(result.entries.find((entry) => entry.type === "release")?.date).toBe("2026-10-28T00:00:00.000Z");
    expect(result.states.map((state) => state.version)).toEqual(["1.0.30001821", "1.0.30001821"]);
    expect(result.states[0]?.lastSuccessAt).toBe("2026-10-31T12:00:00.000Z");
  });

  it("records a Can I Use release without a diff on the first run", async () => {
    const result = await ingestSource(
      "caniuse",
      ctx({
        [SOURCE_URLS.caniuseMeta]: fixture("caniuse/meta-1821.json"),
        [SOURCE_URLS.caniuseData("1.0.30001821")]: fixture("caniuse/data-1821.json"),
      }),
    );
    expect(result.entries.map((entry) => entry.type)).toEqual(["release"]);
    expect(result.skipped).toBe(false);
  });

  it("skips Can I Use and MDN when the npm version is unchanged or the metadata is 304", async () => {
    const same = await ingestSource(
      "caniuse",
      ctx({ [SOURCE_URLS.caniuseMeta]: fixture("caniuse/meta-1821.json") }, [
        { source: "caniuse", url: SOURCE_URLS.caniuseMeta, version: "1.0.30001821" },
      ]),
    );
    expect(same.skipped).toBe(true);
    expect(same.entries).toEqual([]);

    const cached = await ingestSource("mdn-bcd", ctx({ [SOURCE_URLS.mdnMeta]: unchanged }));
    expect(cached.skipped).toBe(true);
    expect(cached.states[0]?.etag).toBe('"same"');
  });

  it("diffs MDN release notes and compat records", async () => {
    const result = await ingestSource(
      "mdn-bcd",
      ctx(
        {
          [SOURCE_URLS.mdnMeta]: fixture("mdn/meta-8.1.7.json"),
          [SOURCE_URLS.mdnRelease]: fixture("mdn/release.json"),
          [SOURCE_URLS.mdnReleases]: fixture("mdn/release.json"),
          [SOURCE_URLS.mdnData("8.1.7")]: fixture("mdn/data-8.1.7.json"),
          [SOURCE_URLS.mdnData("8.1.6")]: fixture("mdn/data-8.1.6.json"),
        },
        [{ source: "mdn-bcd", url: SOURCE_URLS.mdnMeta, version: "8.1.6" }],
      ),
    );
    expect(result.skipped).toBe(false);
    expect(result.entries.map((entry) => entry.id).sort()).toEqual([
      "mdn-bcd:feature:api.CSSAnchorPositioning",
      "mdn-bcd:feature:css.properties.overflow-clip-margin",
      "mdn-bcd:feature:css.properties.reading-order",
      "mdn-bcd:release:8.1.7",
      "mdn-bcd:support-change:css.properties.overflow-clip-margin:firefox:145",
    ]);
    expect(result.entries.find((entry) => entry.type === "release")?.id).toBe("mdn-bcd:release:8.1.7");
    expect(result.entries.find((entry) => entry.type === "support-change")?.title).toContain("firefox 145");
    expect(result.entries.every((entry) => entry.date === "2026-10-22T00:00:00.000Z")).toBe(true);
    expect(result.entries.some((entry) => entry.title.includes("chrome 100"))).toBe(false);
    expect(result.states).toHaveLength(3);
  });

  it("still publishes an MDN release when the data payload is empty", async () => {
    const result = await ingestSource(
      "mdn-bcd",
      ctx(
        {
          [SOURCE_URLS.mdnMeta]: fixture("mdn/meta-8.1.7.json"),
          [SOURCE_URLS.mdnRelease]: unchanged,
          [SOURCE_URLS.mdnReleases]: "[]",
          [SOURCE_URLS.mdnData("8.1.7")]: "",
        },
        [{ source: "mdn-bcd", url: SOURCE_URLS.mdnMeta, version: "8.1.6" }],
      ),
    );
    expect(result.entries.map((entry) => entry.id)).toEqual(["mdn-bcd:release:8.1.7"]);
    expect(result.entries[0]?.date).toBe("2026-10-31T12:00:00.000Z");
  });

  it("ingests Node releases, the current LTS line, and the releases feed", async () => {
    const result = await ingestSource(
      "node",
      ctx({
        [SOURCE_URLS.nodeIndex]: fixture("node/index.json"),
        [SOURCE_URLS.nodeSchedule]: fixture("node/schedule.json"),
        [SOURCE_URLS.nodeRss]: fixture("node/releases.xml"),
      }),
    );
    expect(result.skipped).toBe(false);
    expect(result.entries.map((entry) => entry.id).sort()).toEqual([
      "node:lts:26.13.0",
      "node:release:27.0.0-alpha",
      "node:security:26.12.1",
      "node:security:node-js-security-advisory",
    ]);
    expect(result.states[0]?.version).toBe("v27.0.0-alpha");
    expect(result.states[1]?.version).toBe("v26 Lithium");
    const security = result.entries.find((entry) => entry.id === "node:security:26.12.1");
    expect(security?.type).toBe("security");
    expect(security?.tags).toEqual(expect.arrayContaining(["security", "lts"]));
  });

  it("limits Node releases to versions newer than the stored index and skips when nothing changed", async () => {
    const newer = await ingestSource(
      "node",
      ctx(
        {
          [SOURCE_URLS.nodeIndex]: fixture("node/index.json"),
          [SOURCE_URLS.nodeSchedule]: unchanged,
          [SOURCE_URLS.nodeRss]: unchanged,
        },
        [{ source: "node", url: SOURCE_URLS.nodeIndex, version: "v26.13.0" }],
      ),
    );
    expect(newer.entries.map((entry) => entry.version)).toEqual(["27.0.0-alpha"]);

    const skipped = await ingestSource(
      "node",
      ctx({
        [SOURCE_URLS.nodeIndex]: unchanged,
        [SOURCE_URLS.nodeSchedule]: unchanged,
        [SOURCE_URLS.nodeRss]: unchanged,
      }),
    );
    expect(skipped.skipped).toBe(true);
    expect(skipped.entries).toEqual([]);
  });

  it("keeps a changed Node feed when the index is unchanged", async () => {
    const result = await ingestSource(
      "node",
      ctx({
        [SOURCE_URLS.nodeIndex]: unchanged,
        [SOURCE_URLS.nodeSchedule]: unchanged,
        [SOURCE_URLS.nodeRss]: fixture("node/releases.xml"),
      }),
    );
    expect(result.skipped).toBe(false);
    expect(result.entries.map((entry) => entry.type).sort()).toEqual(["lts", "security"]);
  });

  it("ingests TypeScript dist-tags, GitHub releases, and the Atom feed", async () => {
    const result = await ingestSource(
      "typescript",
      ctx({
        [SOURCE_URLS.tsMeta]: fixture("typescript/packument.json"),
        [SOURCE_URLS.tsReleases]: fixture("typescript/releases.json"),
        [SOURCE_URLS.tsFeed]: fixture("typescript/feed.xml"),
      }),
    );
    expect(result.skipped).toBe(false);
    expect(result.entries.map((entry) => entry.id).sort()).toEqual([
      "typescript:article:announcing-typescript-7-0",
      "typescript:release:7.0.2",
      "typescript:release:7.1.0-beta",
    ]);
    expect(result.entries.some((entry) => entry.version?.includes("-dev."))).toBe(false);
    expect(result.entries.find((entry) => entry.type === "article")?.url).toBe(
      "https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/",
    );
    expect(result.states[0]?.version).toBe("7.0.2");
  });

  it("ingests stable Next.js releases and drops canaries, prereleases, and drafts", async () => {
    const result = await ingestSource(
      "nextjs",
      ctx({
        [SOURCE_URLS.nextLatest]: fixture("nextjs/latest.json"),
        [SOURCE_URLS.nextReleases]: fixture("nextjs/releases.json"),
        [SOURCE_URLS.nextFeed]: fixture("nextjs/feed.xml"),
      }),
    );
    expect(result.skipped).toBe(false);
    expect(result.entries.map((entry) => entry.id).sort()).toEqual([
      "nextjs:article:cache-components",
      "nextjs:release:16.4.3",
    ]);
    expect(result.states[0]?.version).toBe("v16.4.3");
    expect(result.entries.find((entry) => entry.type === "article")?.summary).toContain("How caching works.");
  });

  it("stores a canary tag without emitting a canary entry", async () => {
    const result = await ingestSource(
      "nextjs",
      ctx({
        [SOURCE_URLS.nextLatest]: fixture("nextjs/latest-canary.json"),
        [SOURCE_URLS.nextReleases]: unchanged,
        [SOURCE_URLS.nextFeed]: unchanged,
      }),
    );
    expect(result.skipped).toBe(false);
    expect(result.entries).toEqual([]);
    expect(result.states[0]?.version).toBe("v16.5.0-canary.35");
  });

  it("skips Next.js and TypeScript when every response is 304", async () => {
    const next = await ingestSource(
      "nextjs",
      ctx({
        [SOURCE_URLS.nextLatest]: unchanged,
        [SOURCE_URLS.nextReleases]: unchanged,
        [SOURCE_URLS.nextFeed]: unchanged,
      }),
    );
    const typescript = await ingestSource(
      "typescript",
      ctx({
        [SOURCE_URLS.tsMeta]: unchanged,
        [SOURCE_URLS.tsReleases]: unchanged,
        [SOURCE_URLS.tsFeed]: unchanged,
      }),
    );
    expect(next.skipped).toBe(true);
    expect(typescript.skipped).toBe(true);
  });

  it.each([
    ["caniuse", SOURCE_URLS.caniuseMeta],
    ["mdn-bcd", SOURCE_URLS.mdnMeta],
    ["node", SOURCE_URLS.nodeIndex],
    ["typescript", SOURCE_URLS.tsMeta],
    ["nextjs", SOURCE_URLS.nextLatest],
  ] as const)("rejects %s non-200 responses and timeouts", async (source, url) => {
    await expect(ingestSource(source, ctx({ [url]: 503 }))).rejects.toThrow(/failed with 503/);
    await expect(ingestSource(source, ctx({ [url]: "timeout" }))).rejects.toThrow(/timeout/i);
  });

  it("rejects malformed JSON after the sibling documents have been fetched", async () => {
    const bad = fixture("shared/malformed.txt");
    await expect(ingestSource("caniuse", ctx({ [SOURCE_URLS.caniuseMeta]: bad }))).rejects.toThrow(/invalid JSON/);
    await expect(ingestSource("mdn-bcd", ctx({ [SOURCE_URLS.mdnMeta]: bad }))).rejects.toThrow(/invalid JSON/);
    await expect(
      ingestSource("node", ctx({
        [SOURCE_URLS.nodeIndex]: bad,
        [SOURCE_URLS.nodeSchedule]: unchanged,
        [SOURCE_URLS.nodeRss]: unchanged,
      })),
    ).rejects.toThrow(/invalid JSON/);
    await expect(
      ingestSource("typescript", ctx({
        [SOURCE_URLS.tsMeta]: bad,
        [SOURCE_URLS.tsReleases]: unchanged,
        [SOURCE_URLS.tsFeed]: unchanged,
      })),
    ).rejects.toThrow(/invalid JSON/);
    await expect(
      ingestSource("nextjs", ctx({
        [SOURCE_URLS.nextLatest]: bad,
        [SOURCE_URLS.nextReleases]: unchanged,
        [SOURCE_URLS.nextFeed]: unchanged,
      })),
    ).rejects.toThrow(/invalid JSON/);
  });

  it("rejects metadata that is missing a version and payloads of the wrong shape", async () => {
    await expect(
      ingestSource("caniuse", ctx({ [SOURCE_URLS.caniuseMeta]: fixture("caniuse/meta-missing-version.json") })),
    ).rejects.toThrow(/missing a version/);
    await expect(
      ingestSource("mdn-bcd", ctx({ [SOURCE_URLS.mdnMeta]: fixture("mdn/meta-missing-version.json") })),
    ).rejects.toThrow(/missing a version/);
    await expect(
      ingestSource(
        "caniuse",
        ctx({
          [SOURCE_URLS.caniuseMeta]: fixture("caniuse/meta-1821.json"),
          [SOURCE_URLS.caniuseData("1.0.30001821")]: "",
        }),
      ),
    ).rejects.toThrow(/empty/i);
    await expect(
      ingestSource(
        "caniuse",
        ctx({
          [SOURCE_URLS.caniuseMeta]: fixture("caniuse/meta-1821.json"),
          [SOURCE_URLS.caniuseData("1.0.30001821")]: fixture("shared/malformed.txt"),
        }),
      ),
    ).rejects.toThrow(/Can I Use data returned invalid JSON/);
    await expect(
      ingestSource(
        "node",
        ctx({
          [SOURCE_URLS.nodeIndex]: fixture("node/index-not-array.json"),
          [SOURCE_URLS.nodeSchedule]: unchanged,
          [SOURCE_URLS.nodeRss]: unchanged,
        }),
      ),
    ).rejects.toThrow(/must be an array/);
    const arrayPayload = await ingestSource(
      "typescript",
      ctx({
        [SOURCE_URLS.tsMeta]: fixture("typescript/packument-array.json"),
        [SOURCE_URLS.tsReleases]: unchanged,
        [SOURCE_URLS.tsFeed]: unchanged,
      }),
    );
    expect(arrayPayload.entries).toEqual([]);
    await expect(
      ingestSource(
        "typescript",
        ctx({
          [SOURCE_URLS.tsMeta]: "null",
          [SOURCE_URLS.tsReleases]: unchanged,
          [SOURCE_URLS.tsFeed]: unchanged,
        }),
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(TypeError);
      expect((error as Error).message).toMatch(/must be an object/);
      return true;
    });
    await expect(
      ingestSource(
        "node",
        ctx({
          [SOURCE_URLS.nodeIndex]: unchanged,
          [SOURCE_URLS.nodeSchedule]: unchanged,
          [SOURCE_URLS.nodeRss]: fixture("shared/unclosed.xml"),
        }),
      ),
    ).rejects.toThrow();
  });

  it("rejects null TypeScript metadata as packument validation", async () => {
    await expect(
      ingestSource(
        "typescript",
        ctx({
          [SOURCE_URLS.tsMeta]: "null",
          [SOURCE_URLS.tsReleases]: unchanged,
          [SOURCE_URLS.tsFeed]: unchanged,
        }),
      ),
    ).rejects.toThrow(/must be an object/);
  });

  it("treats an empty changed body as no entries for Node metadata", async () => {
    const result = await ingestSource(
      "node",
      ctx({
        [SOURCE_URLS.nodeIndex]: "",
        [SOURCE_URLS.nodeSchedule]: unchanged,
        [SOURCE_URLS.nodeRss]: unchanged,
      }),
    );
    expect(result.skipped).toBe(false);
    expect(result.entries).toEqual([]);
  });

  it("keeps Can I Use and MDN feature keys when the dataset version is set", async () => {
    const caniuse = await ingestSource(
      "caniuse",
      ctx(
        {
          [SOURCE_URLS.caniuseMeta]: fixture("caniuse/meta-1821.json"),
          [SOURCE_URLS.caniuseData("1.0.30001821")]: fixture("caniuse/data-1821.json"),
          [SOURCE_URLS.caniuseData("1.0.30001820")]: fixture("caniuse/data-1820.json"),
        },
        [{ source: "caniuse", url: SOURCE_URLS.caniuseMeta, version: "1.0.30001820" }],
      ),
    );
    expect(caniuse.entries.map((entry) => entry.id).sort()).toEqual([
      "caniuse:feature:anchor-positioning",
      "caniuse:feature:unnamed-feature",
      "caniuse:release:1.0.30001821",
      "caniuse:support-change:css-grid:firefox:120",
    ]);
    const mdn = await ingestSource(
      "mdn-bcd",
      ctx(
        {
          [SOURCE_URLS.mdnMeta]: fixture("mdn/meta-8.1.7.json"),
          [SOURCE_URLS.mdnRelease]: fixture("mdn/release.json"),
          [SOURCE_URLS.mdnReleases]: fixture("mdn/release.json"),
          [SOURCE_URLS.mdnData("8.1.7")]: fixture("mdn/data-8.1.7.json"),
          [SOURCE_URLS.mdnData("8.1.6")]: fixture("mdn/data-8.1.6.json"),
        },
        [{ source: "mdn-bcd", url: SOURCE_URLS.mdnMeta, version: "8.1.6" }],
      ),
    );
    expect(mdn.entries.map((entry) => entry.id).sort()).toEqual([
      "mdn-bcd:feature:api.CSSAnchorPositioning",
      "mdn-bcd:feature:css.properties.overflow-clip-margin",
      "mdn-bcd:feature:css.properties.reading-order",
      "mdn-bcd:release:8.1.7",
      "mdn-bcd:support-change:css.properties.overflow-clip-margin:firefox:145",
    ]);
  });

  it("runs every source when each conditional request is unchanged", async () => {
    const routes: Record<string, FetchRoute> = {
      [SOURCE_URLS.mdnMeta]: unchanged,
      [SOURCE_URLS.caniuseMeta]: unchanged,
      [SOURCE_URLS.nodeIndex]: unchanged,
      [SOURCE_URLS.nodeSchedule]: unchanged,
      [SOURCE_URLS.nodeRss]: unchanged,
      [SOURCE_URLS.tsMeta]: unchanged,
      [SOURCE_URLS.tsReleases]: unchanged,
      [SOURCE_URLS.tsFeed]: unchanged,
      [SOURCE_URLS.nextLatest]: unchanged,
      [SOURCE_URLS.nextReleases]: unchanged,
      [SOURCE_URLS.nextFeed]: unchanged,
    };
    const results = await ingestAll(ctx(routes));
    expect(results.map((result) => result.source)).toEqual(["mdn-bcd", "caniuse", "node", "typescript", "nextjs"]);
    expect(results.every((result) => result.skipped && result.entries.length === 0)).toBe(true);
  });

  it("limits ingestAll to the requested sources and propagates fetcher failures", async () => {
    const onlyNode = await ingestAll(
      ctx({
        [SOURCE_URLS.nodeIndex]: unchanged,
        [SOURCE_URLS.nodeSchedule]: unchanged,
        [SOURCE_URLS.nodeRss]: unchanged,
      }),
      ["node"],
    );
    expect(onlyNode.map((result) => result.source)).toEqual(["node"]);
    await expect(ingestAll(ctx({ [SOURCE_URLS.caniuseMeta]: 502 }), ["caniuse"])).rejects.toThrow(/502/);
  });
});
