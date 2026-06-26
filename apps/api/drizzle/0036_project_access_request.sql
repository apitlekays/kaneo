CREATE TABLE IF NOT EXISTS "project_access_request" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_access_request_project_user_unique" UNIQUE("project_id","user_id"),
	CONSTRAINT "project_access_request_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "project_access_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_access_request_projectId_idx" ON "project_access_request" USING btree ("project_id");
