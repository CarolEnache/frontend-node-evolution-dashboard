import { parseWorkerArgs } from "./args";
import { formatIngestSummary, runOnce } from "./run";
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
  console.log(formatIngestSummary(result));
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
  const result = await runOnce({ sources: args.sources });
  logResult(result);
  // A revalidate outage is a warning in the summary ("revalidate failed") and
  // does not fail the job. Source failures still exit 1.
  process.exit(result.failed.length > 0 ? 1 : 0);
}
