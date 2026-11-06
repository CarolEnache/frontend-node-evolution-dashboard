import { readAppEnv, readNodeEnv, type AppEnvironment } from "@evolution/shared-types";

/** Called when the ingest worker process starts, before any fetch. */
export function logWorkerStartup(
  env: NodeJS.ProcessEnv | { APP_ENV?: string | null; NODE_ENV?: string | null } = process.env,
): AppEnvironment {
  console.log("hello world");
  const appEnv = readAppEnv(env);
  const nodeEnv = readNodeEnv(env);
  console.log(`[startup] worker APP_ENV=${appEnv} NODE_ENV=${nodeEnv}`);
  return appEnv;
}
