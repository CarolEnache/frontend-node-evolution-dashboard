import { readAppEnv, type AppEnvironment } from "@evolution/shared-types";

/** Next.js calls this from `instrumentation.ts` when the server starts. */
export function logWebStartup(env: NodeJS.ProcessEnv = process.env): AppEnvironment {
  console.log("hello world");
  const appEnv = readAppEnv(env);
  console.log(`[startup] web APP_ENV=${appEnv} NODE_ENV=${env.NODE_ENV ?? ""}`);
  return appEnv;
}
