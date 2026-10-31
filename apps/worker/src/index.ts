import cron from "node-cron";
import type { Source } from "@evolution/shared-types";
import { SOURCE_CADENCE_HOURS } from "@evolution/ingest";
import { runOnce } from "./run";

const everySix: Source[] = (Object.entries(SOURCE_CADENCE_HOURS) as Array<[Source, number]>)
  .filter(([, hours]) => hours === 6)
  .map(([source]) => source);
const everyTwelve: Source[] = (Object.entries(SOURCE_CADENCE_HOURS) as Array<[Source, number]>)
  .filter(([, hours]) => hours === 12)
  .map(([source]) => source);

let running = false;

async function guarded(sources: Source[]) {
  if (running) {
    console.log("[ingest] previous run still in progress");
    return;
  }
  running = true;
  try {
    const result = await runOnce({ sources });
    console.log(`[ingest] upserted ${result.upserted}, skipped ${result.skipped.join(",") || "none"}, failed ${result.failed.join(",") || "none"}`);
  } finally {
    running = false;
  }
}

const schedule = process.argv.includes("--schedule");
if (!schedule) {
  const result = await runOnce();
  console.log(`[ingest] upserted ${result.upserted}, skipped ${result.skipped.join(",") || "none"}, failed ${result.failed.join(",") || "none"}`);
  process.exit(result.failed.length > 0 ? 1 : 0);
}

cron.schedule("0 */6 * * *", () => {
  void guarded(everySix);
});
cron.schedule("0 */12 * * *", () => {
  void guarded(everyTwelve);
});
console.log("[ingest] scheduler started (MDN, Can I Use, Node every 6h; TypeScript and Next.js every 12h)");
