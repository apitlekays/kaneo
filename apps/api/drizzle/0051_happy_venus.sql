CREATE TABLE "letter_disposition" (
	"id" text PRIMARY KEY NOT NULL,
	"letter_id" text NOT NULL,
	"action" text NOT NULL,
	"authorized_by" text,
	"certificate_object_key" text,
	"certificate_hash" text,
	"note" text,
	"executed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "letter_legal_hold" (
	"id" text PRIMARY KEY NOT NULL,
	"letter_id" text NOT NULL,
	"reason" text NOT NULL,
	"placed_by" text,
	"placed_at" timestamp DEFAULT now() NOT NULL,
	"released_by" text,
	"released_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "letter_disposition" ADD CONSTRAINT "letter_disposition_letter_id_letter_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."letter"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_disposition" ADD CONSTRAINT "letter_disposition_authorized_by_user_id_fk" FOREIGN KEY ("authorized_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_legal_hold" ADD CONSTRAINT "letter_legal_hold_letter_id_letter_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."letter"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_legal_hold" ADD CONSTRAINT "letter_legal_hold_placed_by_user_id_fk" FOREIGN KEY ("placed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_legal_hold" ADD CONSTRAINT "letter_legal_hold_released_by_user_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "letter_disposition_letterId_idx" ON "letter_disposition" USING btree ("letter_id");--> statement-breakpoint
CREATE INDEX "letter_legal_hold_letterId_idx" ON "letter_legal_hold" USING btree ("letter_id");