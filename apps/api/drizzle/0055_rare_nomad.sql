CREATE TABLE "letter_minute_update" (
	"id" text PRIMARY KEY NOT NULL,
	"minute_id" text NOT NULL,
	"author_id" text,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "letter_attachment" ADD COLUMN "minute_update_id" text;--> statement-breakpoint
ALTER TABLE "letter_minute_update" ADD CONSTRAINT "letter_minute_update_minute_id_letter_minute_id_fk" FOREIGN KEY ("minute_id") REFERENCES "public"."letter_minute"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_minute_update" ADD CONSTRAINT "letter_minute_update_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "letter_minute_update_minuteId_idx" ON "letter_minute_update" USING btree ("minute_id");