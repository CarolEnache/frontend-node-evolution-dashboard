import { describe, expect, it, vi } from "vitest";
import { buildSummaryMessages, createMemoryCache, enrichEntry } from "@evolution/ai";
import { normaliseEntry } from "@evolution/ingest";
import type { Entry } from "@evolution/shared-types";

const MARKDOWN = [
  "> [!NOTE]",
  "> This release is backporting bug fixes. It does **not** include all pending features/changes on canary.",
  "",
  "Use the &lt;details&gt; and &lt;summary&gt; elements inside &lt;main&gt;.",
  "See the [upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16).",
].join("\n");

const PLAIN =
  "This release is backporting bug fixes. It does not include all pending features/changes on canary. Use the &lt;details&gt; and &lt;summary&gt; elements inside &lt;main&gt;. See the upgrade guide.";

describe("plain summaries reach the API payload and enrichment", () => {
  it("normalises once, then the entries payload and the summary prompt use that text", async () => {
    const entry = normaliseEntry({
      source: "nextjs",
      type: "release",
      version: "16.4.6",
      title: "v16.4.6",
      date: "2026-11-09",
      url: "https://github.com/vercel/next.js/releases/tag/v16.4.6",
      summary: MARKDOWN,
    });
    expect(entry.summary).toBe(PLAIN);

    const payload = JSON.parse(JSON.stringify({ entries: [entry] })) as { entries: Entry[] };
    expect(payload.entries[0]?.summary).toBe(PLAIN);
    expect(payload.entries[0]?.summary).not.toContain("[!NOTE]");
    expect(payload.entries[0]?.summary).not.toContain("**");
    expect(payload.entries[0]?.summary).not.toContain("https://");

    const prompt = buildSummaryMessages(entry, ["React"]);
    expect(prompt[1]?.content).toContain(PLAIN);
    expect(prompt[1]?.content).not.toContain("[!NOTE]");

    const summarize = vi.fn(async (got: Entry) => got.summary);
    const embed = vi.fn(async (texts: string[]) => {
      expect(texts).toEqual([`v16.4.6\n${PLAIN}`]);
      return [[1, 0]];
    });
    const enriched = await enrichEntry(entry, {
      embedder: { modelId: "test-embed", embed },
      cache: createMemoryCache(),
      profile: { role: "lead", skills: ["React"] },
      profileVectors: [[0, 1]],
      summarizer: { modelId: "test-summary", summarize },
    });
    expect(embed).toHaveBeenCalledOnce();
    expect(summarize).toHaveBeenCalledWith(expect.objectContaining({ summary: PLAIN }), ["React"]);
    expect(enriched.summary).toBe(PLAIN);
    expect(enriched.worthLearning).toBe(PLAIN);
  });
});
