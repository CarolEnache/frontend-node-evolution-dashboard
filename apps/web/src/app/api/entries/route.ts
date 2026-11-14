import { createDb } from "@evolution/db";
import { filterEntries } from "@evolution/shared-types";
import { dateFilterError, parseQuery } from "@/lib/filters";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = parseQuery(Object.fromEntries(url.searchParams.entries()));
  const dateError = dateFilterError(parsed);
  if (dateError) return Response.json({ error: dateError }, { status: 400 });
  if (parsed.invalid) return Response.json({ entries: [] });
  const db = await createDb();
  try {
    // Apply source/type/gap/tag/from/to in the database first so a date range
    // is not limited to the newest 1000 rows and then dropped in memory.
    const entries = filterEntries(await db.listEntries({ ...parsed.filter, limit: 1000 }), parsed.filter);
    return Response.json({ entries });
  } finally {
    await db.close();
  }
}
