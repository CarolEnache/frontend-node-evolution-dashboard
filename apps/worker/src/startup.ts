import { readAppEnv, type AppEnvironment } from "@evolution/shared-types";

/** Called when the ingest worker process starts, before any fetch. */
export function logWorkerStartup(env: NodeJS.ProcessEnv = process.env): AppEnvironment {
  console.log("hello world");
  const appEnv = readAppEnv(env);
  console.log(`[startup] worker APP_ENV=${appEnv} NODE_ENV=${env.NODE_ENV ?? ""}`);
  return appEnv;
}
