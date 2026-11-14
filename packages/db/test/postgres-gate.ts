/** How the real-Postgres suite behaves. CI must not silently skip a missing URL. */
export function postgresIntegrationAction(env: { CI?: string; POSTGRES_TEST_URL?: string }): "run" | "skip" | "fail" {
  const url = env.POSTGRES_TEST_URL?.trim() ?? "";
  if (url) return "run";
  return env.CI ? "fail" : "skip";
}
