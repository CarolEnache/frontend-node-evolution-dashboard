import { beforeEach, vi } from "vitest";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input);
      throw new Error(`Unexpected network fetch: ${url}`);
    }),
  );
});
