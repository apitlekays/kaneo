CREATE TABLE "workspace_page_access" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"page_slug" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_page_access_unique" UNIQUE("workspace_id","user_id","page_slug")
);
--> statement-breakpoint
ALTER TABLE "workspace_page_access" ADD CONSTRAINT "workspace_page_access_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_page_access" ADD CONSTRAINT "workspace_page_access_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_page_access_workspaceId_idx" ON "workspace_page_access" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workspace_page_access_userId_idx" ON "workspace_page_access" USING btree ("user_id");