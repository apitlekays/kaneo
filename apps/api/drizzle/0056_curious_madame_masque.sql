ALTER TABLE "letter_minute" ADD COLUMN "acceptance" text DEFAULT 'accepted' NOT NULL;--> statement-breakpoint
ALTER TABLE "letter_minute" ADD COLUMN "rejection_reason" text;