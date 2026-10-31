import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const appDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  cacheComponents: true,
  partialPrefetching: true,
  transpilePackages: ["@evolution/shared-types", "@evolution/db"],
  serverExternalPackages: ["better-sqlite3", "pg", "@huggingface/transformers", "onnxruntime-node"],
  turbopack: {
    root: path.resolve(appDir, "../.."),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
