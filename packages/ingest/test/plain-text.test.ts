import { describe, expect, it } from "vitest";
import { normaliseEntry } from "../src/normalise";
import { toPlainTextExcerpt } from "../src/plain-text";

/**
 * GitHub body of vercel/next.js v16.4.6. Normalisation stores the plain excerpt.
 */
const NEXT_16_4_6_RELEASE = [
  "> [!NOTE]",
  "> This release is backporting bug fixes. It does **not** include all pending features/changes on canary.",
  "",
  "### Core Changes",
  "",
  "- [lts-active] Pin Tailwind to 4.3.3 in create-next-app and tests (#101061, #101176) (#101307)",
  "- [lts-active] Automatically compress route handler responses if not already compressed (#101280)",
  "- [lts-active] Turbopack GC fixes for dev (#100279, #100370) (#101308)",
  "",
  "### Credits",
  "",
  "Huge thanks to @lukesandberg and @eps1lon for helping!",
].join("\r\n");

const NEXT_16_4_6_PLAIN = [
  "This release is backporting bug fixes. It does not include all pending features/changes on canary. Core Changes [lts-active] Pin Tailwind to 4.3.3 in create-next-app and tests (#101061, #101176) (#101307) [lts-active] Automatically compress route handler responses if not already compressed (#101280) [lts-active] Turbopack GC fixes for dev (#100279, #100370) (#101308) Credits",
  "",
  "Huge thanks to @lukesandberg and @eps1lon for helping!",
].join("\n");

describe("toPlainTextExcerpt", () => {
  it("turns the Next.js 16.4.6 release note into a plain excerpt", () => {
    expect(toPlainTextExcerpt(NEXT_16_4_6_RELEASE)).toBe(NEXT_16_4_6_PLAIN);
  });

  it("cleans a one-line note that still has the alert marker", () => {
    const collapsed = NEXT_16_4_6_RELEASE.replace(/\s+/g, " ").trim();
    expect(collapsed.startsWith("> [!NOTE] >")).toBe(true);
    expect(toPlainTextExcerpt(collapsed)).toBe(
      "This release is backporting bug fixes. It does not include all pending features/changes on canary. Core Changes - [lts-active] Pin Tailwind to 4.3.3 in create-next-app and tests (#101061, #101176) (#101307) - [lts-active] Automatically compress route handler responses if not already compressed (#101280) - [lts-active] Turbopack GC fixes for dev (#100279, #100370) (#101308) Credits Huge thanks to @lukesandberg and @eps1lon for helping!",
    );
  });

  it("keeps link text and drops images, fences, and emphasis from a Next.js note", () => {
    const note = [
      "> [!WARNING]",
      "> Read the upgrade notes before adopting Cache Components.",
      "",
      "## Highlights",
      "",
      "- Fix RSC navigation and runtime prefetches in `next start`",
      "- Keep `inline_atom` and `--debug-prerender` names intact",
      "- Requires Node > 18 and npm >= 10",
      "",
      "```ts",
      'const version = "16.4.3";',
      "```",
      "",
      "![Next.js 16](https://nextjs.org/static/blog/next-16/twitter-card.png)",
      "",
      'See the [upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16 "Upgrade to 16") and [#101061](https://github.com/vercel/next.js/pull/101061).',
      "A [second note][note] points at the same guide.",
      "![banner][card]",
      "",
      "[note]: https://nextjs.org/docs/app/guides/upgrading/version-16",
      "[card]: https://nextjs.org/static/blog/next-16/twitter-card.png",
      "",
      "---",
      "",
      "1. Enable `cacheComponents` in `next.config.ts`.",
      "",
      '<p>Cache Components keep the <code>dashboard</code> fresh.<br/>Read <a href="https://nextjs.org/blog/next-16">the blog</a>.</p>',
      "<script>alert(1)</script><style>.x{color:red}</style>",
      '<img alt="diagram" src="x.png" onerror="alert(1)">',
      "<!-- draft -->",
      "Use Array<string> for the params list. ~~old flag~~ *fresh* ***both*** **strong** _single_ default.",
    ].join("\n");

    const plain = toPlainTextExcerpt(note);
    expect(plain).toContain("Read the upgrade notes before adopting Cache Components.");
    expect(plain).toContain("Highlights");
    expect(plain).toContain("Fix RSC navigation and runtime prefetches in next start");
    expect(plain).toContain("inline_atom");
    expect(plain).toContain("--debug-prerender");
    expect(plain).toContain("Requires Node > 18 and npm >= 10");
    expect(plain).toContain('const version = "16.4.3";');
    expect(plain).toContain("See the upgrade guide and #101061.");
    expect(plain).toContain("A second note points at the same guide.");
    expect(plain).toContain("Enable cacheComponents in next.config.ts.");
    expect(plain).toContain("Cache Components keep the dashboard fresh. Read the blog.");
    expect(plain).toContain("Use Array<string> for the params list. old flag fresh both strong single default.");
    expect(plain).not.toContain("[!WARNING]");
    expect(plain).not.toContain("##");
    expect(plain).not.toContain("```");
    expect(plain).not.toContain("`");
    expect(plain).not.toContain("**");
    expect(plain).not.toContain("![");
    expect(plain).not.toContain("twitter-card");
    expect(plain).not.toContain("https://");
    expect(plain).not.toMatch(/<\/?(?:p|code|a|script|img|style|br)\b/i);
    expect(plain).toContain("Array<string>");
    expect(plain).not.toContain("banner");
    expect(plain).not.toContain("onerror");
    expect(plain).not.toContain("alert(1)");
    expect(plain).not.toContain("color:red");
    expect(plain).not.toContain("~~");
    expect(plain).not.toMatch(/^>/);
    expect(plain).not.toContain("> [!");
  });

  it("keeps spaces that were not introduced by stripping", () => {
    expect(toPlainTextExcerpt("Fixed .d.ts")).toBe("Fixed .d.ts");
    expect(toPlainTextExcerpt("./configure")).toBe("./configure");
    expect(toPlainTextExcerpt("Load .env")).toBe("Load .env");
    expect(toPlainTextExcerpt("a ? b : c")).toBe("a ? b : c");
    expect(toPlainTextExcerpt("x ?? y")).toBe("x ?? y");
  });

  it("keeps identifiers and multiplication that only look like emphasis", () => {
    expect(toPlainTextExcerpt("Do not touch __proto__ when computing 2 * 3 * 4.")).toBe(
      "Do not touch __proto__ when computing 2 * 3 * 4.",
    );
    expect(toPlainTextExcerpt("Call out a __two words__ phrase and **bold** text.")).toBe(
      "Call out a two words phrase and bold text.",
    );
  });

  it("keeps the label of a security advisory link and drops a bracket cut off by the summary clamp", () => {
    const stored =
      "This release contains security fixes for the following advisories: ## Moderate - [Cross-tenant sensitive information disclosure in Next.js 'use cache' when called through unstable_cache](https://github.com/vercel/next.js/security/advisories/GHSA-mfr8-8qww-v76h) - [SVG rejection bypass in Next.js i…";
    expect(toPlainTextExcerpt(stored)).toBe(
      "This release contains security fixes for the following advisories: Moderate - Cross-tenant sensitive information disclosure in Next.js 'use cache' when called through unstable_cache - SVG rejection bypass in Next.js i…",
    );
  });

  it("strips every GitHub alert marker, including on a one-line summary", () => {
    const stored =
      "> [!TIP] > Prefer the [upgrade guide](https://nextjs.org/docs). > [!IMPORTANT] > Ship the patch. > [!CAUTION] > Do not skip `next start`.";
    expect(toPlainTextExcerpt(stored)).toBe("Prefer the upgrade guide. Ship the patch. Do not skip next start.");
  });

  it("leaves encoded element names for a later entity decode", () => {
    const summary = "Use the &lt;details&gt; and &lt;summary&gt; elements inside &lt;main&gt;; avoid soup.";
    const entry = normaliseEntry({
      source: "typescript",
      type: "article",
      key: "elements",
      title: "Elements",
      date: "2026-11-01",
      url: "https://devblogs.microsoft.com/typescript/elements",
      summary,
    });
    expect(entry.summary).toBe(summary);
    expect(toPlainTextExcerpt("hello&nbsp;world")).toBe("hello world");
    expect(toPlainTextExcerpt("TypeScript&#8217;s checker still says &#39;string&#39; &amp; never decodes &nbsp; here.")).toBe(
      "TypeScript&#8217;s checker still says &#39;string&#39; &amp; never decodes   here.",
    );
    expect(toPlainTextExcerpt("See <main and <details")).toBe("See <main and <details");
  });

  it("stores the Next.js release as plain text", () => {
    const entry = normaliseEntry({
      source: "nextjs",
      type: "release",
      version: "16.4.6",
      title: "v16.4.6",
      date: "2026-11-09",
      url: "https://github.com/vercel/next.js/releases/tag/v16.4.6",
      summary: NEXT_16_4_6_RELEASE,
    });
    expect(entry.summary).toBe(NEXT_16_4_6_PLAIN);
  });

  it("unwraps collapsed fences, tilde fences, autolinks, and setext headings", () => {
    expect(toPlainTextExcerpt('Run ```ts const version = "16.4.3" ``` now.')).toBe(
      'Run ts const version = "16.4.3" now.',
    );
    const setext = ["Cache Components", "================", "", "~~~txt", "keep this", "~~~"].join("\n");
    expect(toPlainTextExcerpt(setext)).toBe("Cache Components keep this");
    expect(toPlainTextExcerpt("See <https://nextjs.org/blog> now.")).toBe("See https://nextjs.org/blog now.");
    expect(toPlainTextExcerpt("Before [![Next.js 16](https://nextjs.org/card.png)](https://nextjs.org/blog) after")).toBe(
      "Before after",
    );
    expect(toPlainTextExcerpt("Read [the docs](https://en.wikipedia.org/wiki/Next.js_(framework)).")).toBe(
      "Read the docs.",
    );
  });

  it("caps a long image-marker run before the link scan", () => {
    const input = "![".repeat(40_000);
    const started = performance.now();
    const plain = toPlainTextExcerpt(input);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(plain.length).toBeLessThanOrEqual(20_000);
    expect(plain.startsWith("![")).toBe(true);
  });

  it("leaves an already plain summary unchanged and drops empty input", () => {
    const plain = "Stable Next.js 16.4.3. Turbopack is the default for dev and build.";
    expect(toPlainTextExcerpt(plain)).toBe(plain);
    expect(toPlainTextExcerpt("  \n\t ")).toBe("");
    expect(toPlainTextExcerpt(toPlainTextExcerpt(NEXT_16_4_6_RELEASE))).toBe(NEXT_16_4_6_PLAIN);
  });
});
