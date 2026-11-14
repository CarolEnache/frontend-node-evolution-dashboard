import {
  assertNotNeonDatabase,
  cleanupNodeAlphaEntries,
  createDb,
  resolveDatabaseTarget,
} from "@evolution/db";

// Dry-run unless --apply is passed. Never connects to a Neon database.
const apply = process.argv.includes("--apply");
const target = resolveDatabaseTarget();
assertNotNeonDatabase(target.url, target.appEnv);

void (async () => {
  const db = await createDb(target.url);
  try {
    const result = await cleanupNodeAlphaEntries(db, { apply });
    console.log(JSON.stringify({ ...result, dialect: db.dialect }, null, 2));
    if (!apply) console.log("Dry run only. Pass --apply to merge the orphaned Node alpha ids.");
  } finally {
    await db.close();
  }
})();
