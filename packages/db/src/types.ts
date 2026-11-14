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
  getJson(key: string, model: string, kind: string): Promise<unknown | null>;
  setJson(key: string, model: string, kind: string, value: unknown): Promise<void>;
  getNeurons(day: string): Promise<number>;
  /** Atomically add `amount` for that UTC day when the new total is within `limit`. */
  reserveNeurons(day: string, amount: number, limit: number): Promise<boolean>;
  listEntryFields(ids: string[]): Promise<Array<{ id: string; title: string; summary: string; tags: string[] }>>;
}
