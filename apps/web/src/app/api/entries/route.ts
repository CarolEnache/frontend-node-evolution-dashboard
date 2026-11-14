import { createDb } from "@evolution/db";
import { filterEntries } from "@evolution/shared-types";
import { parseQuery, queryRecord } from "@/lib/filters";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = parseQuery(queryRecord(url.searchParams));
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
