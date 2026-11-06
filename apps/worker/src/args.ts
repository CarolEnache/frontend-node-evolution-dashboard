import { isSource, SOURCES, type Source } from "@evolution/shared-types";

export interface WorkerArgs {
  schedule: boolean;
  sources?: Source[];
}

export function parseWorkerArgs(argv: string[]): WorkerArgs {
  let schedule = false;
  const sources: Source[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--schedule") {
      schedule = true;
      continue;
    }
    if (arg === "--once") continue;
    if (arg === "--source" || arg === "--sources") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--source needs a source name");
      index += 1;
      sources.push(...parseSourceList(value));
      continue;
    }
    if (arg.startsWith("--source=")) {
      sources.push(...parseSourceList(arg.slice("--source=".length)));
    }
  }
  return sources.length > 0 ? { schedule, sources } : { schedule };
}

function parseSourceList(value: string): Source[] {
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) throw new Error("--source needs a source name");
  return parts.map((part) => {
    if (!isSource(part)) {
      throw new Error(`Unknown source "${part}". Expected one of: ${SOURCES.join(", ")}`);
    }
    return part;
  });
}
