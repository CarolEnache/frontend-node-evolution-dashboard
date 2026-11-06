import { readAppEnv, readNodeEnv, type AppEnvironment } from "@evolution/shared-types";

/** Next.js calls this from `instrumentation.ts` when the server starts. */
export function logWebStartup(
  env: NodeJS.ProcessEnv | { APP_ENV?: string | null; NODE_ENV?: string | null } = process.env,
): AppEnvironment {
  console.log("hello world");
  const appEnv = readAppEnv(env);
  const nodeEnv = readNodeEnv(env);
  console.log(`[startup] web APP_ENV=${appEnv} NODE_ENV=${nodeEnv}`);
  return appEnv;
}
