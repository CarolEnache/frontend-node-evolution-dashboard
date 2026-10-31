import { createDb } from "@evolution/db";
import { filterEntries } from "@evolution/shared-types";
import { parseQuery } from "@/lib/filters";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = parseQuery(Object.fromEntries(url.searchParams.entries()));
  if (parsed.invalid) return Response.json({ entries: [] });
  const db = await createDb();
  try {
    const entries = filterEntries(await db.listEntries({ limit: 1000 }), parsed.filter);
    return Response.json({ entries });
  } finally {
    await db.close();
  }
}
