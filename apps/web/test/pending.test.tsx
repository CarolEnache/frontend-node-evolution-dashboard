import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardSkeleton } from "../src/components/skeleton";
import { isPlainActivation } from "../src/lib/is-plain-activation";

describe("isPlainActivation", () => {
  it("accepts a primary click without modifiers", () => {
    expect(isPlainActivation({})).toBe(true);
    expect(isPlainActivation({ button: 0 })).toBe(true);
  });

  it("rejects modified or cancelled activations", () => {
    expect(isPlainActivation({ button: 1 })).toBe(false);
    expect(isPlainActivation({ metaKey: true })).toBe(false);
    expect(isPlainActivation({ ctrlKey: true })).toBe(false);
    expect(isPlainActivation({ shiftKey: true })).toBe(false);
    expect(isPlainActivation({ altKey: true })).toBe(false);
    expect(isPlainActivation({ defaultPrevented: true })).toBe(false);
  });
});

describe("dashboard skeleton a11y", () => {
  it("announces a busy loading status and uses motion-safe pulse", () => {
    const html = renderToStaticMarkup(<DashboardSkeleton label="Loading the timeline" />);
    expect(html).toContain("Loading the timeline");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("motion-safe:animate-pulse");
  });
});
