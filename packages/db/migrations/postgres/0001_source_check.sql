ALTER TABLE "source_state" ADD COLUMN IF NOT EXISTS "last_error" text;--> statement-breakpoint
ALTER TABLE "source_state" ADD COLUMN IF NOT EXISTS "status" text;
