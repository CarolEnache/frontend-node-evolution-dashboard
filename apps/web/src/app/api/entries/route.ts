import { createDb } from "@evolution/db";
import { filterEntries } from "@evolution/shared-types";
import { TIMELINE_LIMIT } from "@/lib/entries";
import { parseQuery } from "@/lib/filters";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = parseQuery(Object.fromEntries(url.searchParams.entries()));
  if (parsed.invalid) return Response.json({ entries: [] });
  const db = await createDb();
  try {
    // Source, type, gap, tag, and date filters run in SQL before TIMELINE_LIMIT.
    const entries = filterEntries(await db.listEntries({ ...parsed.filter, limit: TIMELINE_LIMIT }), parsed.filter);
    return Response.json({ entries });
  } finally {
    await db.close();
  }
}
