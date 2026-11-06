import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.join(root, "apps/web/src"),
      "@evolution/ai": path.join(root, "packages/ai/src/index.ts"),
      "@evolution/db": path.join(root, "packages/db/src/index.ts"),
      "@evolution/ingest": path.join(root, "packages/ingest/src/index.ts"),
      "@evolution/shared-types": path.join(root, "packages/shared-types/src/index.ts"),
      "server-only": path.join(root, "test/shims/server-only.ts"),
      "next/cache": path.join(root, "test/shims/next-cache.ts"),
    },
  },
  test: {
    environment: "node",
    include: [
      "packages/**/test/**/*.test.ts",
      "apps/**/test/**/*.test.ts",
      "apps/**/test/**/*.test.tsx",
      "test/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/.next/**"],
    setupFiles: ["test/setup.ts"],
    unstubEnvs: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov", "html"],
      reportsDirectory: "coverage",
      // Entrypoints run on import (DB CLI opens a database; the worker schedules and may exit).
      exclude: ["packages/db/src/cli.ts", "apps/worker/src/index.ts"],
      include: [
        "packages/ingest/src/**/*.ts",
        "packages/ai/src/**/*.ts",
        "packages/db/src/**/*.ts",
        "packages/shared-types/src/**/*.ts",
        "apps/web/src/lib/**/*.ts",
        "apps/worker/src/**/*.ts",
      ],
    },
  },
});
