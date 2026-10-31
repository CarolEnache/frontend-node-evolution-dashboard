import { rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { e2eDatabasePath, e2eDatabaseUrl, repoRoot } from "./constants";

export default async function globalSetup() {
  await rm(e2eDatabasePath, { force: true });
  await rm(`${e2eDatabasePath}-wal`, { force: true });
  await rm(`${e2eDatabasePath}-shm`, { force: true });
  execFileSync("pnpm", ["db:setup"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: e2eDatabaseUrl },
  });
}
