/**
 * Plain-text excerpt of a stored summary.
 * Markdown, GitHub alert markers, images, and HTML tags are removed.
 * Link labels are kept. Callers render the result as text, not HTML.
 * Character entities such as &#8217; are left unchanged.
 */
const HTML_TAG =
  "a|abbr|article|aside|audio|b|blockquote|br|button|caption|code|col|colgroup|dd|del|details|div|dl|dt|em|figcaption|figure|footer|h[1-6]|header|hr|i|img|ins|kbd|label|li|main|mark|nav|ol|p|picture|pre|q|s|samp|script|section|small|source|span|strong|style|sub|summary|sup|table|tbody|td|tfoot|th|thead|tr|u|ul|video|wbr|iframe";

const ALERT = "\\[![A-Za-z][A-Za-z0-9_-]*\\]";

export function toPlainTextExcerpt(input: string): string {
  let text = input.replace(/\r\n?/g, "\n");
  text = unwrapFences(text);
  text = stripHtml(text);
  text = stripMarkdownLinks(text);
  text = stripAlertsAndQuotes(text);
  text = stripBlockMarkers(text);
  text = stripEmphasis(text);
  text = text.replace(/\s+/g, " ").replace(/ ([.,;:!?])/g, "$1").trim();
  return text;
}

function unwrapFences(input: string): string {
  let text = input.replace(/```[^\n`]*\n([\s\S]*?)```/g, (_match, body: string) => body);
  text = text.replace(/~~~[^\n~]*\n([\s\S]*?)~~~/g, (_match, body: string) => body);
  text = text.replace(/```([\s\S]*?)```/g, "$1");
  text = text.replace(/~~~([\s\S]*?)~~~/g, "$1");
  return text;
}

function stripHtml(input: string): string {
  let text = input.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  text = text.replace(new RegExp(`<(?:${HTML_TAG})\\b[^>]*>`, "gi"), " ");
  text = text.replace(new RegExp(`</(?:${HTML_TAG})\\s*>`, "gi"), " ");
  return text;
}

function stripMarkdownLinks(input: string): string {
  let text = input.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  text = text.replace(/!\[[^\]]*\]\[[^\]]*\]/g, " ");
  text = text.replace(/\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)/g, (_match, label: string) => label);
  text = text.replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1");
  text = text.replace(/^\s*\[[^\]]+\]:[ \t]+\S.*$/gm, " ");
  text = text.replace(/<(https?:\/\/[^>\s]+)>/gi, "$1");
  // clampSummary can cut a link in half, leaving "[label…" with no target.
  text = text.replace(/\[([^\[\]]*)$/g, "$1");
  return text;
}

function stripAlertsAndQuotes(input: string): string {
  const leadingQuotes = /^(?:\s*>\s*)+/;
  const leadingAlert = new RegExp(`^\\s*${ALERT}\\s*`, "i");
  const lines = input.split("\n").map((line) => {
    let rest = line;
    for (let pass = 0; pass < 6; pass += 1) {
      const next = rest.replace(leadingQuotes, "").replace(leadingAlert, "");
      if (next === rest) break;
      rest = next;
    }
    return rest;
  });
  let text = lines.join("\n");
  text = text.replace(new RegExp(`(?:^|\\s)>\\s*${ALERT}(?:\\s*>)*`, "gi"), " ");
  text = text.replace(new RegExp(ALERT, "gi"), " ");
  text = text.replace(/^(?:\s*>\s*)+/, "");
  return text;
}

function stripBlockMarkers(input: string): string {
  let text = input.replace(/(^|\s)#{1,6}(?!#)\s+/g, "$1");
  text = text.replace(/^[ \t]*(?:-{3,}|={3,})[ \t]*$/gm, " ");
  text = text.replace(/(^|\s)(?:-{3,}|={3,})(?=\s|$)/g, "$1");
  text = text.replace(/^[ \t]*[-*+][ \t]+/gm, "");
  text = text.replace(/^[ \t]*\d+[.)][ \t]+/gm, "");
  return text;
}

function stripEmphasis(input: string): string {
  let text = input.replace(/``([^`]+)``/g, "$1");
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, "$1");
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/__([^_\n]+)__/g, "$1");
  text = text.replace(/(^|[\s([{"'])\*([^*\n]+)\*(?=[\s)\].,;:!?'"]|$)/g, "$1$2");
  text = text.replace(/(^|[\s([{"'])_([^_\n]+)_(?=[\s)\].,;:!?'"]|$)/g, "$1$2");
  text = text.replace(/~~([^~\n]+)~~/g, "$1");
  return text;
}
