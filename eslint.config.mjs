import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "**/.next/**",
    "**/dist/**",
    "uploads/**",
    "apps/web/**",
    "data/**",
    "playwright-report/**",
    "test-results/**",
    "coverage/**",
  ]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
]);
