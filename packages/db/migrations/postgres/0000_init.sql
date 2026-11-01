CREATE TABLE "embeddings" (
	"cache_key" text NOT NULL,
	"model" text NOT NULL,
	"kind" text NOT NULL,
	"payload" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "embeddings_cache_key_model_kind_pk" PRIMARY KEY("cache_key","model","kind")
);
--> statement-breakpoint
CREATE TABLE "entries" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"version" text,
	"date" text NOT NULL,
	"url" text NOT NULL,
	"summary" text NOT NULL,
	"tags" text NOT NULL,
	"raw" text NOT NULL,
	"similarity" real,
	"gap" text,
	"worth_learning" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_state" (
	"source" text NOT NULL,
	"url" text NOT NULL,
	"etag" text,
	"last_modified" text,
	"version" text,
	"last_fetched_at" text,
	"last_success_at" text,
	CONSTRAINT "source_state_source_url_pk" PRIMARY KEY("source","url")
);
--> statement-breakpoint
CREATE INDEX "entries_source_date_idx" ON "entries" USING btree ("source","date");--> statement-breakpoint
CREATE INDEX "entries_gap_date_idx" ON "entries" USING btree ("gap","date");