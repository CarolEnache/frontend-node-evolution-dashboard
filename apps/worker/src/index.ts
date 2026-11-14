import { DatabaseCorruptError } from "@evolution/db";
import { parseWorkerArgs } from "./args";
import { runOnce } from "./run";
import { startScheduler } from "./schedule";
import { logWorkerStartup } from "./startup";

logWorkerStartup();

if (process.argv.includes("--startup-only")) {
  process.exit(0);
}

function fail(error: unknown): never {
  console.error(`[ingest] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

let args;
try {
  args = parseWorkerArgs(process.argv.slice(2));
} catch (error) {
  fail(error);
}

function logResult(result: Awaited<ReturnType<typeof runOnce>>) {
  console.log(
    `[ingest] upserted ${result.upserted}, skipped ${result.skipped.join(",") || "none"}, failed ${result.failed.join(",") || "none"}`,
  );
}

if (args.schedule) {
  try {
    startScheduler({
      sources: args.sources,
      run: async (sources) => {
        const result = await runOnce({ sources });
        logResult(result);
      },
    });
  } catch (error) {
    fail(error);
  }
} else {
  try {
    const result = await runOnce({ sources: args.sources });
    logResult(result);
    process.exit(result.failed.length > 0 ? 1 : 0);
  } catch (error) {
    // Corrupt databases exit here. FNED-33 reports config and availability
    // errors from this same catch; keep both checks when the branches merge.
    if (error instanceof DatabaseCorruptError) fail(error);
    throw error;
  }
}
