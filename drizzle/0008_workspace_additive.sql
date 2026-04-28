CREATE TABLE "asset_campaigns" (
	"asset_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	CONSTRAINT "asset_campaigns_asset_id_campaign_id_pk" PRIMARY KEY("asset_id","campaign_id")
);
--> statement-breakpoint
CREATE TABLE "asset_collections" (
	"asset_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "asset_collections_asset_id_collection_id_pk" PRIMARY KEY("asset_id","collection_id")
);
--> statement-breakpoint
CREATE TABLE "asset_review_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_members" (
	"brand_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'creator' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "brand_members_brand_id_user_id_pk" PRIMARY KEY("brand_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "brew_visibility_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brew_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"from_visibility" text,
	"to_visibility" text NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"starts_at" timestamp,
	"ends_at" timestamp,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"share_slug" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "collections_share_slug_unique" UNIQUE("share_slug")
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"uploader_id" uuid NOT NULL,
	"original_filename" text NOT NULL,
	"content_type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uploads_asset_id_unique" UNIQUE("asset_id")
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"can_generate_video" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"mode" text DEFAULT 'hosted' NOT NULL,
	"default_lora_id" text,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "brands" DROP CONSTRAINT "brands_name_unique";--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "brand_id" uuid;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "parent_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "source" text DEFAULT 'generation' NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "brand_kit_overridden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "prompt_prefix" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "prompt_suffix" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "banned_terms" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "default_lora_id" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "default_lora_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "anchor_reference_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "palette" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "self_approval_allowed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "video_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "is_personal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "brews" ADD COLUMN "is_locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "references" ADD COLUMN "brand_id" uuid;--> statement-breakpoint
ALTER TABLE "asset_campaigns" ADD CONSTRAINT "asset_campaigns_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_campaigns" ADD CONSTRAINT "asset_campaigns_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_collections" ADD CONSTRAINT "asset_collections_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_collections" ADD CONSTRAINT "asset_collections_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_review_log" ADD CONSTRAINT "asset_review_log_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_review_log" ADD CONSTRAINT "asset_review_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_members" ADD CONSTRAINT "brand_members_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_members" ADD CONSTRAINT "brand_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brew_visibility_log" ADD CONSTRAINT "brew_visibility_log_brew_id_brews_id_fk" FOREIGN KEY ("brew_id") REFERENCES "public"."brews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brew_visibility_log" ADD CONSTRAINT "brew_visibility_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_log_asset_idx" ON "asset_review_log" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "review_log_actor_idx" ON "asset_review_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "review_log_created_at_idx" ON "asset_review_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "brand_members_user_idx" ON "brand_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "brew_visibility_log_brew_idx" ON "brew_visibility_log" USING btree ("brew_id");--> statement-breakpoint
CREATE INDEX "brew_visibility_log_actor_idx" ON "brew_visibility_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "brew_visibility_log_created_at_idx" ON "brew_visibility_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_brand_name_unique" ON "campaigns" USING btree ("brand_id","name");--> statement-breakpoint
CREATE INDEX "campaigns_brand_idx" ON "campaigns" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "collections_brand_idx" ON "collections" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "workspace_members_user_idx" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "references" ADD CONSTRAINT "references_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_brand_id_idx" ON "assets" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "assets_brand_status_idx" ON "assets" USING btree ("brand_id","status");--> statement-breakpoint
CREATE INDEX "assets_parent_idx" ON "assets" USING btree ("parent_asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brands_workspace_name_unique" ON "brands" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "brands_workspace_slug_unique" ON "brands" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE INDEX "brands_workspace_id_idx" ON "brands" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "brands_owner_idx" ON "brands" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "brands_workspace_personal_owner_idx" ON "brands" USING btree ("workspace_id","is_personal","owner_id");