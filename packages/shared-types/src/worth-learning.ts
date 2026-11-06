import type { Entry, Source } from "./index";

/** Matches `stripVersionPrefix` in index.ts. Local so this module does not import it at runtime. */
function stripVersionPrefix(version: string): string {
  return version.trim().replace(/^v(?=\d)/i, "");
}

/**
 * Ranking strategies for the worth-learning view.
 *
 * `heuristicWorthLearningStrategy` is active. It only reads fields the
 * fetchers already store: date, source, type, version, and tags. It does not
 * read `gap`, `similarity`, or `worthLearning`.
 *
 * FNED-6 (tagging) and FNED-7 (embeddings and summaries) fill those fields.
 * When they land, point `activeWorthLearningStrategy` at
 * `enrichmentWorthLearningStrategy`. The dashboard calls
 * `WorthLearningStrategy.select` and does not know which strategy is bound.
 *
 * Heuristic, an entry is flagged when its signal score is at least 16 and it
 * sits inside the window (30 days, inclusive, unless the caller passes
 * `windowDays: null`).
 *
 * Signals, stacked:
 * - security release: 30, reason "Security release"
 * - LTS type or `lts` tag, counted once: 24, reason "LTS release"
 * - `baseline` tag: 28, reason "Baseline status"
 * - support-change: 18, reason "Browser support change"
 * - stable major (`x.0.0`, no prerelease marker): 26, reason "Stable major release"
 * - stable minor (`x.y.0`, y > 0, no prerelease marker): 16, reason "Stable minor release"
 * - MDN or Can I Use feature: 20, reason "Platform feature"
 *
 * Prerelease markers (alpha, beta, rc, canary, nightly, dev) in the version,
 * title, or tags suppress the major and minor bonuses. A stable patch stays on
 * the timeline and is not flagged. Source weight never flags an entry on its own.
 *
 * Rank among flagged entries, highest first:
 *   signal + recencyBonus + sourceWeight
 * recencyBonus = round(20 * (window - ageDays) / window), and 0 once age reaches
 * the window. The decay window is 30 days when the caller disables the cutoff.
 * sourceWeight: mdn-bcd 8, node 7, caniuse 6, typescript 5, nextjs 5.
 * Ties break toward the newer date, then the title.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 30;
const SIGNAL_THRESHOLD = 16;
const RECENCY_POINTS = 20;

const SOURCE_WEIGHT: Record<Source, number> = {
  "mdn-bcd": 8,
  node: 7,
  caniuse: 6,
  typescript: 5,
  nextjs: 5,
};

const PRERELEASE = /\b(?:alpha|beta|rc|canary|nightly|dev)\b/i;

export interface WorthLearningOptions {
  now?: number;
  /**
   * Days back from `now`. `null` keeps every dated entry and still decays
   * recency over the default 30-day span.
   */
  windowDays?: number | null;
}

export interface RankedWorthLearning {
  entry: Entry;
  /** Signal plus recency plus source weight. */
  score: number;
  /** Signal points before recency and source weight. */
  signal: number;
  reasons: string[];
}

export interface WorthLearningStrategy {
  readonly id: string;
  select(entries: readonly Entry[], options?: WorthLearningOptions): RankedWorthLearning[];
}

export function worthLearningRank(entry: Entry): number {
  const recency = Date.parse(entry.date);
  const timestamp = Number.isNaN(recency) ? 0 : recency;
  const similarity = entry.similarity ?? 0;
  return timestamp * (1 - similarity);
}

export const enrichmentWorthLearningStrategy: WorthLearningStrategy = {
  id: "enrichment",
  select(entries, options = {}) {
    const now = options.now ?? Date.now();
    const windowDays = options.windowDays === undefined ? DEFAULT_WINDOW_DAYS : options.windowDays;
    const cutoff = windowDays === null ? Number.NEGATIVE_INFINITY : now - windowDays * DAY_MS;
    return entries
      .filter((entry) => {
        if (entry.gap !== "adjacent" && entry.gap !== "new") return false;
        const time = Date.parse(entry.date);
        return !Number.isNaN(time) && time >= cutoff;
      })
      .slice()
      .sort(
        (a, b) =>
          worthLearningRank(b) - worthLearningRank(a) ||
          (a.date < b.date ? 1 : a.date > b.date ? -1 : a.title.localeCompare(b.title)),
      )
      .map((entry) => ({
        entry,
        score: worthLearningRank(entry),
        signal: entry.gap === "new" ? 2 : 1,
        reasons: [entry.gap === "new" ? "New relative to your profile" : "Adjacent to your profile"],
      }));
  },
};

export function selectWorthLearning(entries: Entry[], now = Date.now(), windowDays = 30): Entry[] {
  return enrichmentWorthLearningStrategy.select(entries, { now, windowDays }).map((item) => item.entry);
}

function hasTag(entry: Entry, tag: string): boolean {
  return entry.tags.some((item) => item.toLowerCase() === tag);
}

function isPrerelease(entry: Entry): boolean {
  return PRERELEASE.test([entry.version ?? "", entry.title, entry.tags.join(" ")].join(" "));
}

function releaseBonus(entry: Entry): { points: number; reason?: string } {
  if (isPrerelease(entry) || !entry.version) return { points: 0 };
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(stripVersionPrefix(entry.version));
  if (!match) return { points: 0 };
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (major > 0 && minor === 0 && patch === 0) return { points: 26, reason: "Stable major release" };
  if (minor > 0 && patch === 0) return { points: 16, reason: "Stable minor release" };
  return { points: 0 };
}

function signalFor(entry: Entry): { points: number; reasons: string[] } {
  const reasons: string[] = [];
  let points = 0;
  if (entry.type === "security") {
    points += 30;
    reasons.push("Security release");
  }
  if (entry.type === "lts" || hasTag(entry, "lts")) {
    points += 24;
    reasons.push("LTS release");
  }
  if (hasTag(entry, "baseline")) {
    points += 28;
    reasons.push("Baseline status");
  }
  if (entry.type === "support-change") {
    points += 18;
    reasons.push("Browser support change");
  }
  const release = releaseBonus(entry);
  if (release.reason) {
    points += release.points;
    reasons.push(release.reason);
  }
  if ((entry.source === "mdn-bcd" || entry.source === "caniuse") && entry.type === "feature") {
    points += 20;
    reasons.push("Platform feature");
  }
  return { points, reasons };
}

function ageInDays(entry: Entry, now: number): number | null {
  const time = Date.parse(entry.date);
  if (Number.isNaN(time)) return null;
  return Math.max(0, (now - time) / DAY_MS);
}

function recencyBonus(age: number, windowDays: number): number {
  if (age >= windowDays) return 0;
  return Math.round((RECENCY_POINTS * (windowDays - age)) / windowDays);
}

export const heuristicWorthLearningStrategy: WorthLearningStrategy = {
  id: "heuristic",
  select(entries, options = {}) {
    const now = options.now ?? Date.now();
    const windowDays = options.windowDays === undefined ? DEFAULT_WINDOW_DAYS : options.windowDays;
    const decayWindow = windowDays && windowDays > 0 ? windowDays : DEFAULT_WINDOW_DAYS;
    const ranked: RankedWorthLearning[] = [];
    for (const entry of entries) {
      const age = ageInDays(entry, now);
      if (age === null) continue;
      if (windowDays !== null && age > windowDays) continue;
      const signal = signalFor(entry);
      if (signal.points < SIGNAL_THRESHOLD) continue;
      ranked.push({
        entry,
        signal: signal.points,
        reasons: signal.reasons,
        score: signal.points + recencyBonus(age, decayWindow) + SOURCE_WEIGHT[entry.source],
      });
    }
    ranked.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.entry.date !== b.entry.date) return a.entry.date < b.entry.date ? 1 : -1;
      return a.entry.title.localeCompare(b.entry.title);
    });
    return ranked;
  },
};

export const activeWorthLearningStrategy: WorthLearningStrategy = heuristicWorthLearningStrategy;
