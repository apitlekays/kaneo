ALTER TABLE "meeting_minute_item" RENAME COLUMN "agenda" TO "topic";--> statement-breakpoint
ALTER TABLE "meeting_minute_item" ADD COLUMN "numbering" text;--> statement-breakpoint
ALTER TABLE "meeting_minute_item" ADD COLUMN "status" text;