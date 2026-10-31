import path from "node:path";

export const repoRoot = process.cwd();
export const e2eDatabasePath = path.join(repoRoot, "data", "e2e.sqlite");
export const e2eDatabaseUrl = `file:${e2eDatabasePath}`;
export const e2ePort = 43187;
export const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;
