CREATE TABLE "meeting_archivist" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_archivist_ws_user_unique" UNIQUE("workspace_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "meeting" ADD COLUMN "reference_no" text;--> statement-breakpoint
ALTER TABLE "meeting" ADD COLUMN "chairperson" text;--> statement-breakpoint
ALTER TABLE "meeting" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "meeting_archivist" ADD CONSTRAINT "meeting_archivist_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "meeting_archivist" ADD CONSTRAINT "meeting_archivist_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "meeting_archivist" ADD CONSTRAINT "meeting_archivist_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "meeting_archivist_userId_idx" ON "meeting_archivist" USING btree ("user_id");