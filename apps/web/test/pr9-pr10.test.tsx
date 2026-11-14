import { renderToStaticMarkup } from "react-dom/server";
import { buildSeedEntries } from "@evolution/db";
import { SOURCES, type Entry, type RankedWorthLearning, type Source } from "@evolution/shared-types";
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
import { SOURCE_ORDER } from "../src/lib/filters";

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

function anchorOpeningTag(html: string, href: string): string {
  const tags = html.match(/<a\b[^>]*>/g) ?? [];
  const tag = tags.find((item) => item.includes(`href="${href}"`));
  expect(tag, href).toBeDefined();
  return tag ?? "";
}

/** Same-tab navigation: the card's "Opening the source" state runs on click. */
function expectSameTabAnchor(html: string, href: string) {
  const tag = anchorOpeningTag(html, href);
  expect(tag).not.toMatch(/\btarget=/);
  expect(tag).not.toMatch(/\brel=/);
}

function renderedMark(html: string): string {
  const match = html.match(/<span\b[^>]*>([^<]*)<\/span><div class="min-w-0">/);
  return match?.[1] ?? "";
}

const SEEDED = buildSeedEntries(new Date("2026-10-31T00:00:00.000Z"));

function missingSourceEntry(id: string): Entry {
  return entry({
    id,
    title: "No source yet",
    date: "2026-10-30T00:00:00.000Z",
    url: "",
    summary: "This card has no source URL.",
  });
}

function linkedEntry(id: string): Entry {
  return entry({
    id,
    title: "Has a source",
    date: "2026-10-29T00:00:00.000Z",
    url: "https://example.com/linked",
    summary: "This card keeps its link.",
  });
}

/**
 * Bug: EntrySourceLink always renders an anchor. An empty URL becomes <a href="">
 * and navigates to the current page instead of a non-link title.
 */
function expectPlainSourceTitle(html: string) {
  expect(html).toMatch(/<span\b[^>]*>No source yet<\/span>/);
  expect(html).not.toMatch(/<a\b[^>]*>No source yet<\/a>/);
  expect(html).not.toMatch(/<a\b[^>]*href=""/);
}

describe("source links", () => {
  it("points each card at its source href and does not set target or rel", () => {
    const html = timeline(SEEDED);
    for (const item of SEEDED) {
      expectSameTabAnchor(html, item.url);
    }

    const worth = renderToStaticMarkup(
      <WorthLearningView
        items={[
          {
            entry: SEEDED.find((item) => item.id === "mcp:security:servers-2.4.0")!,
            score: 40,
            signal: 20,
            reasons: ["Security release"],
          },
        ]}
        emptyDatabase={false}
        invalid={false}
      />,
    );
    expectSameTabAnchor(worth, "https://github.com/modelcontextprotocol/servers/releases/tag/v2.4.0");
  });

  it("locks the mark table to every source", () => {
    expect(Object.keys(SOURCE_MARK).sort()).toEqual([...SOURCES].sort());
    expect(new Set(SOURCE_ORDER)).toEqual(new Set(SOURCES));
  });

  it.each([...SOURCES])("renders the %s mark on that card", (source) => {
    const html = timeline([
      entry({
        id: `mark-${source}`,
        title: `Card for ${source}`,
        date: "2026-10-30T00:00:00.000Z",
        source,
        url: "https://example.com/card",
        summary: "Mark check.",
      }),
    ]);
    const mark = renderedMark(html);
    expect(mark).toBe(SOURCE_MARK[source]);
    expect(mark.trim()).not.toBe("");
  });

  // pending FNED ticket: expected failure. The fix PR MUST change this it.fails(...) to it(...).
  it.fails("timeline renders a missing source URL as plain text on that card (pending FNED ticket)", () => {
    // Bug: EntrySourceLink always renders an anchor, so an empty URL is <a href="">.
    const html = timeline([missingSourceEntry("bare"), linkedEntry("linked")]);
    expect(html).toContain('href="https://example.com/linked"');
    expectPlainSourceTitle(html);
  });

  // pending FNED ticket: expected failure. The fix PR MUST change this it.fails(...) to it(...).
  it.fails("worth-learning renders a missing source URL as plain text on that card (pending FNED ticket)", () => {
    // Bug: EntrySourceLink always renders an anchor, so an empty URL is <a href="">.
    const items: RankedWorthLearning[] = [
      { entry: missingSourceEntry("bare"), score: 10, signal: 5, reasons: ["Missing source"] },
      { entry: linkedEntry("linked"), score: 20, signal: 5, reasons: ["Has a link"] },
    ];
    const html = renderToStaticMarkup(<WorthLearningView items={items} emptyDatabase={false} invalid={false} />);
    expect(html).toContain('href="https://example.com/linked"');
    expectPlainSourceTitle(html);
  });
});

describe("new-entry badge", () => {
  it("shows New with the rounded similarity, and Untagged when the gap is missing", () => {
    const beta = SEEDED.find((item) => item.id === "typescript:release:7.1.0-beta")!;
    const html = timeline([beta]);
    expect(html).toContain('title="40% similar to your profile"');
    expect(html).toMatch(/>New<span\b[^>]*>40%<\/span>/);

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

function optionTags(html: string): string[] {
  return html.match(/<option\b[^>]*>[\s\S]*?<\/option>/g) ?? [];
}

function optionValue(tag: string): string {
  return /value="([^"]*)"/.exec(tag)?.[1] ?? "";
}

function optionLabel(tag: string): string {
  return />([^<]*)<\/option>/.exec(tag)?.[1] ?? "";
}

function isSelected(tag: string): boolean {
  return /\bselected(?:=""|\s|>)/.test(tag);
}

describe("tag dropdown", () => {
  it("lists All tags, sorted options, and the current value even when it is not in the list", () => {
    const tags = optionTags(renderToStaticMarkup(<TagSelect tags={["node", "css", "mcp"]} value="mcp" />));
    expect(tags.map(optionLabel)).toEqual(["All tags", "css", "mcp", "node"]);
    expect(tags.filter(isSelected).map(optionValue)).toEqual(["mcp"]);

    const extra = optionTags(renderToStaticMarkup(<TagSelect tags={["css", "node"]} value="newsletter" />));
    expect(extra.map(optionLabel)).toEqual(["All tags", "css", "newsletter", "node"]);
    expect(extra.filter(isSelected).map(optionValue)).toEqual(["newsletter"]);
  });

  it("marks the select busy while the filter form is pending", () => {
    const html = renderToStaticMarkup(
      <FilterFormPending.Provider value={true}>
        <TagSelect tags={["css"]} />
      </FilterFormPending.Provider>,
    );
    expect(html).toContain('data-testid="tag-select"');
    expect(html).toContain('aria-busy="true"');
    const tags = optionTags(html);
    expect(tags.filter(isSelected).map(optionValue)).toEqual([""]);
    expect(tags.map(optionLabel)).toEqual(["All tags", "css"]);
  });
});

describe("loading state rendering", () => {
  it("renders route skeletons and a quiet card until a source click", () => {
    const timelineSkeleton = renderToStaticMarkup(<LoadingTimeline />);
    const worthSkeleton = renderToStaticMarkup(<LoadingWorthLearning />);
    expect(timelineSkeleton).toContain("Loading the timeline");
    expect(timelineSkeleton).toContain('aria-busy="true"');
    expect(worthSkeleton).toContain("Loading worth learning");
    expect(worthSkeleton).toContain('aria-busy="true"');

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
