import type { Entry, EntryFilter, Source, SourceState } from "@evolution/shared-types";

export interface DashboardDb {
  dialect: "sqlite" | "postgres";
  migrate(): Promise<void>;
  seed(now?: Date): Promise<void>;
  close(): Promise<void>;
  upsertEntries(entries: Entry[]): Promise<void>;
  listEntries(filter?: EntryFilter): Promise<Entry[]>;
  countEntries(): Promise<number>;
  upsertSourceState(state: SourceState): Promise<void>;
  listSourceStates(source?: Source): Promise<SourceState[]>;
  getVector(key: string, model: string): Promise<number[] | null>;
  setVector(key: string, model: string, vector: number[]): Promise<void>;
  getSummary(key: string, model: string): Promise<string | null>;
  setSummary(key: string, model: string, summary: string): Promise<void>;
}
