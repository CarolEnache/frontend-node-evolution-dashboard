import { index, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const entries = sqliteTable(
  "entries",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    version: text("version"),
    date: text("date").notNull(),
    url: text("url").notNull(),
    summary: text("summary").notNull(),
    tags: text("tags").notNull(),
    raw: text("raw").notNull(),
    similarity: real("similarity"),
    gap: text("gap"),
    worthLearning: text("worth_learning"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("entries_source_date_idx").on(table.source, table.date),
    index("entries_gap_date_idx").on(table.gap, table.date),
  ],
);

export const sourceState = sqliteTable(
  "source_state",
  {
    source: text("source").notNull(),
    url: text("url").notNull(),
    etag: text("etag"),
    lastModified: text("last_modified"),
    version: text("version"),
    lastFetchedAt: text("last_fetched_at"),
    lastSuccessAt: text("last_success_at"),
    lastError: text("last_error"),
    status: text("status"),
  },
  (table) => [primaryKey({ columns: [table.source, table.url] })],
);

export const embeddings = sqliteTable(
  "embeddings",
  {
    cacheKey: text("cache_key").notNull(),
    model: text("model").notNull(),
    kind: text("kind").notNull(),
    payload: text("payload").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.cacheKey, table.model, table.kind] })],
);
