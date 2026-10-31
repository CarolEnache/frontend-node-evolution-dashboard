import { createDb } from "./index";

const command = process.argv[2];
const db = await createDb();
try {
  if (command === "migrate") {
    await db.migrate();
    console.log(`Migrations applied (${db.dialect}).`);
  } else if (command === "seed") {
    await db.migrate();
    await db.seed();
    const count = await db.countEntries();
    console.log(`Seeded ${count} entries (${db.dialect}).`);
  } else {
    console.error("Usage: cli.ts <migrate|seed>");
    process.exitCode = 1;
  }
} finally {
  await db.close();
}
