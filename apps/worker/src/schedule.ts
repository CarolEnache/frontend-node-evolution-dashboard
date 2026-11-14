import { schedule as scheduleCron } from "node-cron";
import { SOURCE_CADENCE_HOURS } from "@evolution/ingest";
import { SOURCE_LABELS, type Source } from "@evolution/shared-types";

const FAST_HOURS = 6;
const SLOW_HOURS = 12;

export interface CadenceGroup {
  hours: number;
  expression: string;
  sources: Source[];
}

export interface CronTask {
  stop: () => void;
}

export interface CronScheduler {
  schedule(expression: string, task: () => void | Promise<void>): CronTask;
}

export interface StartedScheduler {
  stop: () => void;
  groups: CadenceGroup[];
}

type Env = Record<string, string | undefined>;

export function cronExpressionForHours(hours: number): string {
  if (hours === 24) return "0 0 * * *";
  if (hours === 1) return "0 * * * *";
  return `0 */${hours} * * *`;
}

export function cadenceGroups(env: Env = process.env, only?: readonly Source[]): CadenceGroup[] {
  const globalRaw = env.INGEST_INTERVAL_HOURS?.trim();
  const globalHours = globalRaw ? readHours(globalRaw) : undefined;
  const fastHours = globalHours ?? readHours(env.INGEST_FAST_HOURS?.trim(), FAST_HOURS);
  const slowHours = globalHours ?? readHours(env.INGEST_SLOW_HOURS?.trim(), SLOW_HOURS);
  const buckets = new Map<number, Source[]>();
  for (const [source, defaultHours] of Object.entries(SOURCE_CADENCE_HOURS) as Array<[Source, number]>) {
    if (only && only.length > 0 && !only.includes(source)) continue;
    const hours =
      globalHours ??
      (defaultHours === FAST_HOURS ? fastHours : defaultHours === SLOW_HOURS ? slowHours : defaultHours);
    const list = buckets.get(hours) ?? [];
    list.push(source);
    buckets.set(hours, list);
  }
  return [...buckets.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([hours, sources]) => ({
      hours,
      expression: cronExpressionForHours(hours),
      sources,
    }));
}

export function startScheduler(options: {
  run: (sources: Source[]) => Promise<unknown>;
  cron?: CronScheduler;
  env?: Env;
  sources?: readonly Source[];
  log?: (message: string) => void;
}): StartedScheduler {
  const groups = cadenceGroups(options.env ?? process.env, options.sources);
  if (groups.length === 0) throw new Error("No sources to schedule");
  const cron = options.cron ?? nodeCronScheduler();
  const log = options.log ?? console.log;
  let running = false;
  const tasks = groups.map((group) =>
    cron.schedule(group.expression, () => {
      if (running) {
        log("[ingest] previous run still in progress");
        return;
      }
      running = true;
      let pending: Promise<unknown>;
      try {
        pending = Promise.resolve(options.run(group.sources));
      } catch (error) {
        pending = Promise.reject(error);
      }
      void pending
        .catch((error: unknown) => {
          log(`[ingest] scheduled run failed: ${error instanceof Error ? error.message : String(error)}`);
        })
        .finally(() => {
          running = false;
        });
    }),
  );
  log(startedMessage(groups));
  return {
    groups,
    stop() {
      for (const task of tasks) task.stop();
    },
  };
}

function readHours(value: string | undefined, fallback?: number): number {
  if (value === undefined || value === "") {
    if (fallback === undefined) throw new Error("Ingest interval is missing");
    return fallback;
  }
  if (!/^\d+$/.test(value)) {
    throw new Error(`Ingest interval must be a whole number of hours, received "${value}"`);
  }
  const parsed = Number(value);
  if (parsed < 1 || parsed > 24) {
    throw new Error(`Ingest interval must be between 1 and 24 hours, received ${parsed}`);
  }
  return parsed;
}

function startedMessage(groups: CadenceGroup[]): string {
  const fast = groups[0];
  const slow = groups[1];
  if (
    groups.length === 2 &&
    fast?.hours === FAST_HOURS &&
    slow?.hours === SLOW_HOURS &&
    fast.sources.join() === "mdn-bcd,caniuse,node" &&
    slow.sources.join() === "typescript,nextjs"
  ) {
    return "[ingest] scheduler started (MDN, Can I Use, Node every 6h; TypeScript and Next.js every 12h)";
  }
  const detail = groups
    .map((group) => `${group.sources.map((source) => SOURCE_LABELS[source]).join(", ")} every ${group.hours}h`)
    .join("; ");
  return `[ingest] scheduler started (${detail})`;
}

function nodeCronScheduler(): CronScheduler {
  return {
    schedule(expression, task) {
      const scheduled = scheduleCron(expression, () => {
        void task();
      });
      return {
        stop() {
          void scheduled.stop();
        },
      };
    },
  };
}
