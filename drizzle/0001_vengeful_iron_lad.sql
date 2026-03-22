ALTER TABLE "assets" ADD COLUMN "media_type" text DEFAULT 'image' NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "duration" real;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "has_audio" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "job_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified" timestamp;--> statement-breakpoint
CREATE INDEX "assets_media_type_idx" ON "assets" USING btree ("media_type");