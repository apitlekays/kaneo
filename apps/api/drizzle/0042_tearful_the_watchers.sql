CREATE TABLE "asset_reminder_sent" (
	"id" text PRIMARY KEY NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" text NOT NULL,
	"reminder_window" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "asset_reminder_sent_unique" UNIQUE("ref_type","ref_id","reminder_window")
);
--> statement-breakpoint
CREATE INDEX "asset_reminder_sent_ref_idx" ON "asset_reminder_sent" USING btree ("ref_type","ref_id");