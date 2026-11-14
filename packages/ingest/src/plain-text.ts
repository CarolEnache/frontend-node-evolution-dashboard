/**
 * Plain-text excerpt of a release note or article summary.
 * Real HTML tags, Markdown, and GitHub alert markers are removed.
 * Link labels are kept. Character entities are left encoded so a later
 * decode can turn `&lt;main&gt;` into the literal text `<main>`.
 */
const ALERT = "\\[![A-Za-z][A-Za-z0-9_-]*\\]";

export function toPlainTextExcerpt(input: string): string {
  let text = input.replace(/\r\n?/g, "\n");
  text = unwrapFences(text);
  text = text.replace(/<(https?:\/\/[^>\s]+)>/gi, "$1");
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
  text = text.replace(/<\/[A-Za-z][^>]*>/g, " ");
  text = text.replace(/(^|[^A-Za-z0-9])<[A-Za-z][^>]*>/g, "$1 ");
  return text;
}

function stripMarkdownLinks(input: string): string {
  let text = input.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  text = text.replace(/!\[[^\]]*\]\[[^\]]*\]/g, " ");
  text = text.replace(/\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)/g, (_match, label: string) => label);
  text = text.replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1");
  text = text.replace(/^\s*\[[^\]]+\]:[ \t]+\S.*$/gm, " ");
  text = text.replace(/\[([^[\]]*)$/g, "$1");
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
  text = text.replace(/\*\*\*(\S(?:[^*\n]*\S)?)\*\*\*/g, "$1");
  text = text.replace(/\*\*(\S(?:[^*\n]*\S)?)\*\*/g, "$1");
  text = text.replace(/__([^_\n]*\s[^_\n]*)__/g, (_match, inner: string) => inner.trim());
  text = text.replace(/(^|[\s([{"'])\*(\S(?:[^*\n]*\S)?)\*(?=[\s)\].,;:!?'"]|$)/g, "$1$2");
  text = text.replace(/(^|[\s([{"'])_(?!_)(\S(?:[^_\n]*\S)?)(?<!_)_(?!_)/g, "$1$2");
  text = text.replace(/~~(\S(?:[^~\n]*\S)?)~~/g, "$1");
  return text;
}
