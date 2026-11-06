import { describe, expect, it, vi } from "vitest";
import type { Source } from "@evolution/shared-types";
import { parseWorkerArgs } from "../src/args";
import { cadenceGroups, cronExpressionForHours, startScheduler, type CronScheduler } from "../src/schedule";

function fakeCron() {
  const jobs: Array<{ expression: string; task: () => void | Promise<void> }> = [];
  const cron: CronScheduler = {
    schedule(expression, task) {
      jobs.push({ expression, task });
      return { stop: vi.fn() };
    },
  };
  return { cron, jobs };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

describe("worker CLI", () => {
  it("runs every source once unless --source narrows the list", () => {
    expect(parseWorkerArgs(["--once"])).toEqual({ schedule: false });
    expect(parseWorkerArgs([])).toEqual({ schedule: false });
    expect(parseWorkerArgs(["--source", "node"])).toEqual({ schedule: false, sources: ["node"] });
    expect(parseWorkerArgs(["--source", "typescript,nextjs"])).toEqual({
      schedule: false,
      sources: ["typescript", "nextjs"],
    });
    expect(parseWorkerArgs(["--source=mdn-bcd"])).toEqual({ schedule: false, sources: ["mdn-bcd"] });
  });

  it("rejects an unknown source", () => {
    expect(() => parseWorkerArgs(["--source", "react"])).toThrow(/Unknown source "react"/);
    expect(() => parseWorkerArgs(["--source"])).toThrow(/--source needs a source name/);
  });
});

describe("ingest scheduler", () => {
  it("maps the default cadences onto cron expressions", () => {
    expect(cronExpressionForHours(6)).toBe("0 */6 * * *");
    expect(cronExpressionForHours(12)).toBe("0 */12 * * *");
    expect(cronExpressionForHours(1)).toBe("0 * * * *");
    expect(cronExpressionForHours(24)).toBe("0 0 * * *");
    const groups = cadenceGroups({});
    expect(groups).toEqual([
      {
        hours: 6,
        expression: "0 */6 * * *",
        sources: ["mdn-bcd", "caniuse", "node"],
      },
      {
        hours: 12,
        expression: "0 */12 * * *",
        sources: ["typescript", "nextjs"],
      },
    ]);
  });

  it("honours per-group and global hour overrides", () => {
    expect(cadenceGroups({ INGEST_FAST_HOURS: "4", INGEST_SLOW_HOURS: "8" }).map((group) => [group.hours, group.sources])).toEqual([
      [4, ["mdn-bcd", "caniuse", "node"]],
      [8, ["typescript", "nextjs"]],
    ]);
    expect(cadenceGroups({ INGEST_INTERVAL_HOURS: "24", INGEST_FAST_HOURS: "nope" })).toEqual([
      {
        hours: 24,
        expression: "0 0 * * *",
        sources: ["mdn-bcd", "caniuse", "node", "typescript", "nextjs"],
      },
    ]);
  });

  it("rejects an interval outside 1 to 24 hours", () => {
    expect(() => cadenceGroups({ INGEST_FAST_HOURS: "0" })).toThrow(/between 1 and 24/);
    expect(() => cadenceGroups({ INGEST_SLOW_HOURS: "weekly" })).toThrow(/whole number of hours/);
  });

  it("starts one job per cadence and skips a tick while a run is in progress", async () => {
    const { cron, jobs } = fakeCron();
    const logs: string[] = [];
    const calls: Source[][] = [];
    let release = () => {};
    const started = startScheduler({
      cron,
      env: {},
      log: (message) => logs.push(message),
      run: (sources) => {
        calls.push(sources);
        return new Promise<void>((resolve) => {
          release = () => resolve();
        });
      },
    });
    expect(logs[0]).toBe(
      "[ingest] scheduler started (MDN, Can I Use, Node every 6h; TypeScript and Next.js every 12h)",
    );
    expect(jobs.map((job) => job.expression)).toEqual(["0 */6 * * *", "0 */12 * * *"]);

    jobs[0]?.task();
    jobs[1]?.task();
    expect(calls).toEqual([["mdn-bcd", "caniuse", "node"]]);
    expect(logs).toContain("[ingest] previous run still in progress");

    release();
    await flush();
    jobs[1]?.task();
    expect(calls[1]).toEqual(["typescript", "nextjs"]);
    started.stop();
  });

  it("clears the in-progress guard when a run throws so the next tick still fires", async () => {
    const { cron, jobs } = fakeCron();
    const logs: string[] = [];
    let calls = 0;
    startScheduler({
      cron,
      env: { INGEST_INTERVAL_HOURS: "6" },
      sources: ["node"],
      log: (message) => logs.push(message),
      run: () => {
        calls += 1;
        return Promise.reject(new Error("database locked"));
      },
    });
    jobs[0]?.task();
    await flush();
    jobs[0]?.task();
    await flush();
    expect(calls).toBe(2);
    expect(logs.some((line) => line.includes("database locked"))).toBe(true);
    expect(jobs).toHaveLength(1);
  });
});
