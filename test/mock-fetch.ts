export type FetchRoute = string | Response | number | "timeout";

export function notModified(etag = '"same"'): Response {
  return new Response(null, { status: 304, headers: { etag } });
}

export function mockFetch(routes: Record<string, FetchRoute | FetchRoute[]>): typeof fetch {
  const cursors = new Map<string, number>();
  return (async (input: string | URL | { url: string }) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const route = routes[url];
    if (route === undefined) throw new Error(`Unexpected fetch ${url}`);
    let next: FetchRoute;
    if (Array.isArray(route)) {
      const index = cursors.get(url) ?? 0;
      cursors.set(url, index + 1);
      const value = route[index];
      if (value === undefined) throw new Error(`No more responses for ${url}`);
      next = value;
    } else {
      next = route;
    }
    if (next === "timeout") {
      const error = new Error("The operation was aborted due to timeout");
      error.name = "TimeoutError";
      throw error;
    }
    if (typeof next === "number") return new Response("upstream failed", { status: next });
    if (typeof next === "string") {
      return new Response(next, {
        status: 200,
        headers: { etag: '"fresh"', "last-modified": "Wed, 28 Oct 2026 00:00:00 GMT" },
      });
    }
    return next;
  }) as typeof fetch;
}
