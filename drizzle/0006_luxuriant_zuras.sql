ALTER TABLE "brews" ADD COLUMN "visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "brews" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "brews" ADD COLUMN "original_brew_id" uuid;--> statement-breakpoint
ALTER TABLE "brews" ADD COLUMN "original_user_id" uuid;--> statement-breakpoint
ALTER TABLE "brews" ADD CONSTRAINT "brews_original_brew_id_brews_id_fk" FOREIGN KEY ("original_brew_id") REFERENCES "public"."brews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brews" ADD CONSTRAINT "brews_original_user_id_users_id_fk" FOREIGN KEY ("original_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brews_visibility_created_at_idx" ON "brews" USING btree ("visibility","created_at");--> statement-breakpoint
ALTER TABLE "brews" ADD CONSTRAINT "brews_slug_unique" UNIQUE("slug");