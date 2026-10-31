import { XMLParser } from "fast-xml-parser";

export interface FeedItem {
  title: string;
  url: string;
  date: string;
  summary: string;
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (value && typeof value === "object" && "#text" in value) {
    const text = (value as { "#text"?: unknown })["#text"];
    return typeof text === "string" ? text.trim() : "";
  }
  return "";
}

function linkOf(value: unknown): string {
  if (typeof value === "string") return value.trim();
  const links = asArray(value as Record<string, unknown> | Array<Record<string, unknown>>);
  const alternate = links.find((link) => link.rel === "alternate" && typeof link.href === "string");
  const first = links.find((link) => typeof link.href === "string");
  const chosen = alternate ?? first;
  return typeof chosen?.href === "string" ? chosen.href : "";
}

export function parseFeed(xml: string): FeedItem[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    removeNSPrefix: true,
  });
  const doc = parser.parse(xml) as Record<string, unknown>;
  if (doc.rss && typeof doc.rss === "object") {
    const channel = (doc.rss as { channel?: { item?: unknown } }).channel;
    return asArray(channel?.item as Record<string, unknown> | Array<Record<string, unknown>>).map((item) => ({
      title: textOf(item.title),
      url: textOf(item.link),
      date: textOf(item.pubDate) || textOf(item.date),
      summary: textOf(item.description) || textOf(item["content:encoded"]) || textOf(item.title),
    })).filter((item) => item.title && item.url && item.date);
  }
  if (doc.feed && typeof doc.feed === "object") {
    const feed = doc.feed as { entry?: unknown };
    return asArray(feed.entry as Record<string, unknown> | Array<Record<string, unknown>>).map((entry) => ({
      title: textOf(entry.title),
      url: linkOf(entry.link),
      date: textOf(entry.updated) || textOf(entry.published),
      summary: textOf(entry.summary) || textOf(entry.content) || textOf(entry.title),
    })).filter((item) => item.title && item.url && item.date);
  }
  return [];
}

export function slugKey(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return slug || "untitled";
}
