import { decode } from "html-entities";

/**
 * Decodes decimal (`&#8217;`), hex (`&#x2019;`), and named (`&rsquo;`) HTML
 * entities. A semicolon is required, so a partial token such as `&not` inside
 * `&notarealentity;` is left alone. Lone surrogates become U+FFFD.
 */
export function decodeHtmlEntities(input: string): string {
  if (!input.includes("&")) return input;
  return replaceLoneSurrogates(decode(input, { level: "html5", scope: "strict" }));
}

function replaceLoneSurrogates(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += value[index]! + value[index + 1]!;
        index += 1;
      } else {
        result += "\uFFFD";
      }
      continue;
    }
    result += code >= 0xdc00 && code <= 0xdfff ? "\uFFFD" : value[index]!;
  }
  return result;
}
