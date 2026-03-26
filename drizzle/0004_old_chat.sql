CREATE TABLE "references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"r2_key" text NOT NULL,
	"r2_url" text NOT NULL,
	"thumbnail_r2_key" text,
	"file_name" text,
	"file_size" integer,
	"width" integer,
	"height" integer,
	"mime_type" text NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brews" ADD COLUMN "image_input" text;--> statement-breakpoint
ALTER TABLE "references" ADD CONSTRAINT "references_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "references_user_id_idx" ON "references" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "references_created_at_idx" ON "references" USING btree ("created_at");