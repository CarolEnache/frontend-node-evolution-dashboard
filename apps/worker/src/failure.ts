import { DatabaseConfigError, DatabaseUnavailableError } from "@evolution/db";

/** Invalid worker settings such as FETCH_TIMEOUT_MS. */
export class WorkerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerConfigError";
  }
}

/**
 * One-line `[ingest]` text for configuration and database failures.
 * Other errors return undefined so unexpected faults still print a stack.
 * FNED-23 reports DatabaseCorruptError from the same catch in index.ts;
 * keep both checks when the branches merge.
 */
export function ingestFailureLine(error: unknown): string | undefined {
  if (!isReportedIngestError(error)) return undefined;
  const message = error.message.split("\n")[0] ?? error.message;
  return `[ingest] ${message}`;
}

function isReportedIngestError(
  error: unknown,
): error is WorkerConfigError | DatabaseConfigError | DatabaseUnavailableError {
  return (
    error instanceof WorkerConfigError ||
    error instanceof DatabaseConfigError ||
    error instanceof DatabaseUnavailableError
  );
}
