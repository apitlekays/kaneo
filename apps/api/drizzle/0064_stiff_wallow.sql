ALTER TABLE "meeting_document" ADD COLUMN "original_object_key" text;--> statement-breakpoint
ALTER TABLE "meeting_document" ADD COLUMN "index_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_document" ADD COLUMN "indexed_at" timestamp;--> statement-breakpoint
ALTER TABLE "meeting_document" ADD COLUMN "index_error" text;--> statement-breakpoint
ALTER TABLE "meeting_document" ADD COLUMN "extracted_text" text;--> statement-breakpoint
ALTER TABLE "meeting_document" ADD COLUMN "extracted_text_search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(extracted_text, ''))) STORED;--> statement-breakpoint
CREATE INDEX "meeting_document_extractedTextSearch_idx" ON "meeting_document" USING gin ("extracted_text_search");--> statement-breakpoint
CREATE INDEX "meeting_document_indexStatus_idx" ON "meeting_document" USING btree ("index_status");