import { renderToStaticMarkup } from "react-dom/server";
import { buildSeedEntries } from "@evolution/db";
import { SOURCES, type Entry, type Source } from "@evolution/shared-types";
import { describe, expect, it } from "vitest";
import { EntryCard } from "../src/components/entry-card";
import { FilterFormPending } from "../src/components/filter-form";
import { GapBadge } from "../src/components/gap-badge";
import { PendingIndicator } from "../src/components/pending-indicator";
import { TagSelect } from "../src/components/tag-select";
import { TimelineView } from "../src/components/timeline-view";
import { WorthLearningView } from "../src/components/worth-learning-view";
import LoadingTimeline from "../src/app/loading";
import LoadingWorthLearning from "../src/app/worth-learning/loading";

/** Short marks rendered beside a card. Locked here so a new source cannot ship with a blank mark. */
const SOURCE_MARK: Record<Source, string> = {
  "mdn-bcd": "MDN",
  caniuse: "CIU",
  node: "Node",
  typescript: "TS",
  nextjs: "Next",
  tc39: "TC39",
  v8: "V8",
  "2ality": "2al",
  "javascript-weekly": "JSWk",
  bytes: "Byte",
  webdev: "web",
  mcp: "MCP",
};

function entry(overrides: Partial<Entry> & Pick<Entry, "id" | "title" | "date">): Entry {
  return {
    source: "node",
    type: "release",
    url: `https://example.com/${overrides.id}`,
    summary: `${overrides.title} summary`,
    tags: ["node"],
    raw: null,
    ...overrides,
  };
}

function timeline(entries: Entry[]): string {
  return renderToStaticMarkup(<TimelineView entries={entries} emptyDatabase={false} invalid={false} />);
}

describe("source links", () => {
  const seeded = buildSeedEntries(new Date("2026-10-31T00:00:00.000Z"));

  it("points each card at its source href and does not set target or rel", () => {
    const html = timeline(seeded);
    for (const item of seeded) {
      expect(html, item.id).toContain(`href="${item.url}"`);
    }
    const anchor = html.match(
      /<a [^>]*href="https:\/\/github.com\/microsoft\/TypeScript\/releases\/tag\/v7\.0\.2"[^>]*>/,
    )?.[0];
    // Same-tab navigation: the card's "Opening the source" state runs on click.
    expect(anchor).toBeDefined();
    expect(anchor).not.toContain("target=");
    expect(anchor).not.toContain("rel=");

    const worth = renderToStaticMarkup(
      <WorthLearningView
        items={[
          {
            entry: seeded.find((item) => item.id === "mcp:security:servers-2.4.0")!,
            score: 40,
            signal: 20,
            reasons: ["Security release"],
          },
        ]}
        emptyDatabase={false}
        invalid={false}
      />,
    );
    expect(worth).toContain('href="https://github.com/modelcontextprotocol/servers/releases/tag/v2.4.0"');
    expect(worth).not.toContain("target=");
    expect(worth).not.toContain("rel=");
  });

  it("renders a mark for every source, including the entries added in #9", () => {
    expect(SOURCES).toEqual(Object.keys(SOURCE_MARK));
    for (const source of SOURCES) {
      const html = timeline([
        entry({
          id: source,
          title: `Card ${source}`,
          date: "2026-10-30T00:00:00.000Z",
          source,
          url: `https://example.com/${source}`,
        }),
      ]);
      expect(html, source).toContain(SOURCE_MARK[source]);
      expect(html).toContain(`href="https://example.com/${source}"`);
    }
    const html = timeline(seeded);
    expect(html).toContain('href="https://2ality.com/"');
    expect(html).toContain('href="https://nodejs.org/en/blog"');
    expect(html).toContain('href="https://github.com/tc39/proposals"');
  });

  it.fails("falls back to plain text when the source URL is missing", () => {
    // Bug: EntrySourceLink always renders an anchor. An empty URL is a link to the current page
    // rather than a non-link title, so a card with no source still looks clickable.
    const html = timeline([
      entry({ id: "bare", title: "No source yet", date: "2026-10-30T00:00:00.000Z", url: "" }),
    ]);
    expect(html).toContain("No source yet");
    expect(html).not.toMatch(/<a\b/);
  });
});

describe("new-entry badge", () => {
  it("shows New with the rounded similarity, and Untagged when the gap is missing", () => {
    const beta = buildSeedEntries(new Date("2026-10-31T00:00:00.000Z")).find(
      (item) => item.id === "typescript:release:7.1.0-beta",
    )!;
    const html = timeline([beta]);
    expect(html).toContain("New");
    expect(html).toContain("40%");
    expect(html).toContain('title="40% similar to your profile"');

    const zero = renderToStaticMarkup(<GapBadge gap="new" similarity={0} />);
    expect(zero).toContain("New");
    expect(zero).toContain("0%");

    const untagged = renderToStaticMarkup(<GapBadge />);
    expect(untagged).toContain("Untagged");
    expect(untagged).not.toContain("New");

    const known = renderToStaticMarkup(<GapBadge gap="already-know" />);
    expect(known).toContain("Already know");
    expect(known).not.toContain("%");
  });
});

describe("tag dropdown", () => {
  it("lists All tags, sorted options, and the current value even when it is not in the list", () => {
    const html = renderToStaticMarkup(<TagSelect tags={["node", "css", "mcp"]} value="mcp" />);
    expect(html.indexOf(">All tags<")).toBeLessThan(html.indexOf(">css<"));
    expect(html.indexOf(">css<")).toBeLessThan(html.indexOf(">mcp<"));
    expect(html.indexOf(">mcp<")).toBeLessThan(html.indexOf(">node<"));
    expect(html).toContain('value="mcp" selected');

    const extra = renderToStaticMarkup(<TagSelect tags={["css", "node"]} value="newsletter" />);
    expect(extra).toContain(">newsletter<");
    expect(extra).toContain('value="newsletter" selected');
    expect(extra.indexOf(">css<")).toBeLessThan(extra.indexOf(">newsletter<"));
    expect(extra.indexOf(">newsletter<")).toBeLessThan(extra.indexOf(">node<"));
  });

  it("marks the select busy while the filter form is pending", () => {
    const html = renderToStaticMarkup(
      <FilterFormPending.Provider value={true}>
        <TagSelect tags={["css"]} />
      </FilterFormPending.Provider>,
    );
    expect(html).toContain('data-testid="tag-select"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('value="" selected');
  });
});

describe("loading state rendering", () => {
  it("renders route skeletons and a quiet card until a source click", () => {
    expect(renderToStaticMarkup(<LoadingTimeline />)).toContain("Loading the timeline");
    expect(renderToStaticMarkup(<LoadingWorthLearning />)).toContain("Loading worth learning");

    const idle = renderToStaticMarkup(
      <EntryCard>
        <a href="https://example.com/idle">Idle card</a>
      </EntryCard>,
    );
    expect(idle).toContain("Idle card");
    expect(idle).not.toContain("Opening the source");
    expect(idle).not.toContain("aria-busy");
    expect(idle).not.toContain('data-testid="pending-indicator"');

    const pending = renderToStaticMarkup(<PendingIndicator pending label="Applying filters" />);
    expect(pending).toContain('data-testid="pending-indicator"');
    expect(pending).toContain('role="status"');
    expect(pending).toContain("Applying filters");

    const hidden = renderToStaticMarkup(<PendingIndicator pending={false} label="Applying filters" />);
    expect(hidden).not.toContain('data-testid="pending-indicator"');
    expect(hidden).not.toContain('role="status"');
    expect(hidden).toContain("opacity-0");
  });
});
