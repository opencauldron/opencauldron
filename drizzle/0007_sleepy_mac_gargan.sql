ALTER TABLE "brews" DROP CONSTRAINT "brews_original_brew_id_brews_id_fk";
--> statement-breakpoint
ALTER TABLE "lora_favorites" ALTER COLUMN "civitai_model_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "lora_favorites" ALTER COLUMN "civitai_version_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "lora_favorites" ADD COLUMN "source" text DEFAULT 'civitai' NOT NULL;--> statement-breakpoint
ALTER TABLE "lora_favorites" ADD COLUMN "hf_repo_id" text;--> statement-breakpoint
CREATE INDEX "lora_favorites_user_source_idx" ON "lora_favorites" USING btree ("user_id","source");