import { register } from "../apps/web/src/instrumentation";

// The repo root is CommonJS, so this entrypoint cannot use top-level await.
void (async () => {
  try {
    await register();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
})();
