import { renderToStaticMarkup } from "react-dom/server";
import type { Entry, RankedWorthLearning } from "@evolution/shared-types";
import { describe, expect, it } from "vitest";
import { DashboardSkeleton } from "../src/components/skeleton";
import { TimelineView } from "../src/components/timeline-view";
import { WorthLearningView } from "../src/components/worth-learning-view";

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

describe("timeline and worth-learning views", () => {
  it("renders the timeline newest first, with empty and invalid states", () => {
    const older = entry({
      id: "old",
      title: "Older feature",
      date: "2026-10-26T01:00:00.000Z",
      source: "mdn-bcd",
    });
    const newer = entry({
      id: "new",
      title: "Newer feature",
      date: "2026-10-30T12:00:00.000Z",
    });
    const html = renderToStaticMarkup(
      <TimelineView entries={[older, newer]} emptyDatabase={false} invalid={false} />,
    );
    expect(html.indexOf("Newer feature")).toBeGreaterThan(-1);
    expect(html.indexOf("Newer feature")).toBeLessThan(html.indexOf("Older feature"));
    expect(html).toContain("Week of 26 Oct 2026");
    expect(html).toContain("https://example.com/new");
    expect(html).toContain('aria-label="Timeline"');

    expect(renderToStaticMarkup(<TimelineView entries={[]} emptyDatabase invalid={false} />)).toContain(
      "The timeline is empty",
    );
    expect(renderToStaticMarkup(<TimelineView entries={[]} emptyDatabase={false} invalid={false} />)).toContain(
      "Nothing in this slice",
    );
    expect(renderToStaticMarkup(<TimelineView entries={[]} emptyDatabase={false} invalid />)).toContain(
      "Those filters are not recognised",
    );
  });

  it("renders ranked worth-learning rows and the empty states", () => {
    const items: RankedWorthLearning[] = [
      {
        entry: entry({ id: "high", title: "High signal", date: "2026-10-30T00:00:00.000Z", type: "security" }),
        score: 70,
        signal: 30,
        reasons: ["Security release"],
      },
      {
        entry: entry({ id: "low", title: "Low signal", date: "2026-10-12T00:00:00.000Z", source: "caniuse", type: "support-change" }),
        score: 36,
        signal: 18,
        reasons: ["Browser support change"],
      },
    ];
    const html = renderToStaticMarkup(<WorthLearningView items={items} emptyDatabase={false} invalid={false} />);
    expect(html.indexOf("High signal")).toBeLessThan(html.indexOf("Low signal"));
    expect(html).toContain("Security release");
    expect(html).toContain("Score 70");
    expect(html).toContain('aria-label="Worth learning"');

    expect(renderToStaticMarkup(<WorthLearningView items={[]} emptyDatabase invalid={false} />)).toContain(
      "Nothing to rank yet",
    );
    expect(renderToStaticMarkup(<WorthLearningView items={[]} emptyDatabase={false} invalid={false} />)).toContain(
      "Nothing worth learning in this slice",
    );
  });

  it("renders stored HTML entities as text, not markup", () => {
    const encoded = entry({
      id: "typescript:article:progress",
      source: "typescript",
      type: "article",
      title: "Progress on TypeScript 7 &#8211; December 2025",
      date: "2025-12-02T17:31:32.000Z",
      summary: "Today we&#8217;re excited to announce the beta [&#8230;]",
      url: "https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/",
    });
    const html = renderToStaticMarkup(
      <TimelineView entries={[encoded]} emptyDatabase={false} invalid={false} />,
    );
    expect(html).toContain("Progress on TypeScript 7 \u2013 December 2025");
    expect(html).toContain("we\u2019re excited");
    expect(html).toContain("[\u2026]");
    expect(html).not.toContain("&#8211;");
    expect(html).not.toContain("&#8217;");
    expect(html).not.toContain("&#8230;");
    expect(html).not.toContain("dangerouslySetInnerHTML");

    const worth = renderToStaticMarkup(
      <WorthLearningView
        items={[{ entry: encoded, score: 12, signal: 6, reasons: ["Stable release"] }]}
        emptyDatabase={false}
        invalid={false}
      />,
    );
    expect(worth).toContain("Progress on TypeScript 7 \u2013 December 2025");
    expect(worth).not.toContain("&#8211;");
    expect(worth).not.toContain("dangerouslySetInnerHTML");
  });

  it("exposes a loading status for each view", () => {
    const html = renderToStaticMarkup(<DashboardSkeleton label="Loading the timeline" />);
    expect(html).toContain("Loading the timeline");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
  });
});
