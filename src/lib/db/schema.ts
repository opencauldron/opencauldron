import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  jsonb,
  real,
  boolean,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ============================================================
// Users
// ============================================================

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),
  role: text("role", { enum: ["admin", "member"] })
    .notNull()
    .default("member"),
  dailyLimit: integer("daily_limit").notNull().default(50),
  hasVideoAccess: boolean("has_video_access").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============================================================
// NextAuth required tables
// ============================================================

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerAccountId] }),
  ]
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })]
);

// ============================================================
// Workspaces (tenant boundary; usually invisible chrome unless you have 2+)
// ============================================================

export const workspaces = pgTable("workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  mode: text("mode", { enum: ["hosted", "self_hosted"] })
    .notNull()
    .default("hosted"),
  // Workspace-wide default LoRA. Brand-default wins; this is the fallback.
  defaultLoraId: text("default_lora_id"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "admin", "member"] })
      .notNull()
      .default("member"),
    // FR-034 video gating — admin permission, NOT badge-earned.
    canGenerateVideo: boolean("can_generate_video").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index("workspace_members_user_idx").on(t.userId),
  ]
);

// ============================================================
// Brands (client / division within a workspace; brand kit lives here)
// ============================================================

export const brands = pgTable(
  "brands",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Nullable in schema.ts to match the post-0008 DB state during the multi-
    // phase migration. Migration 0010 SETs NOT NULL; once every consumer is
    // migrated through Phase 7 the schema.ts annotation tightens too.
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    // See workspaceId — nullable until Phase 7 wraps up. 0010 enforces NOT NULL.
    slug: text("slug"),
    color: text("color").notNull().default("#6366f1"),

    // Brand kit
    promptPrefix: text("prompt_prefix"),
    promptSuffix: text("prompt_suffix"),
    bannedTerms: jsonb("banned_terms").$type<string[]>().notNull().default([]),
    // Optional single brand-default LoRA — wins over workspaces.defaultLoraId at brew-run.
    defaultLoraId: text("default_lora_id"),
    defaultLoraIds: jsonb("default_lora_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    anchorReferenceIds: jsonb("anchor_reference_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    palette: jsonb("palette").$type<string[]>().notNull().default([]),
    selfApprovalAllowed: boolean("self_approval_allowed")
      .notNull()
      .default(false),
    // FR-034: per-brand video kill switch (default true so brands ship enabled).
    videoEnabled: boolean("video_enabled").notNull().default(true),

    // Personal brand carve-out (FR-006/006a/006b)
    isPersonal: boolean("is_personal").notNull().default(false),
    ownerId: uuid("owner_id").references(() => users.id),

    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("brands_workspace_name_unique").on(t.workspaceId, t.name),
    uniqueIndex("brands_workspace_slug_unique").on(t.workspaceId, t.slug),
    index("brands_workspace_id_idx").on(t.workspaceId),
    index("brands_owner_idx").on(t.ownerId),
    // Fast lookup for "user's Personal in this workspace".
    index("brands_workspace_personal_owner_idx").on(
      t.workspaceId,
      t.isPersonal,
      t.ownerId
    ),
  ]
);

export const brandMembers = pgTable(
  "brand_members",
  {
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["brand_manager", "creator", "viewer"] })
      .notNull()
      .default("creator"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.brandId, t.userId] }),
    index("brand_members_user_idx").on(t.userId),
  ]
);

// ============================================================
// Campaigns (brand-locked, M2M to assets, optional)
// ============================================================

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    startsAt: timestamp("starts_at"),
    endsAt: timestamp("ends_at"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("campaigns_brand_name_unique").on(t.brandId, t.name),
    index("campaigns_brand_idx").on(t.brandId),
  ]
);

// ============================================================
// Assets (generated images, videos, AND uploads — polymorphic)
// ============================================================

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    // Single FK — replaces the M2M asset_brands junction (dropped in 0010).
    // Nullable in schema.ts to match the post-0008 DB state during the multi-
    // phase migration. Migration 0010 SETs NOT NULL; schema.ts tightens once
    // every asset-creation call site (Phases 4, 7) passes a brand.
    brandId: uuid("brand_id").references(() => brands.id),
    // Fork lineage (FR-012). Self-FK; nullable. ON DELETE SET NULL via 0010.
    parentAssetId: uuid("parent_asset_id"),
    status: text("status", {
      enum: ["draft", "in_review", "approved", "rejected", "archived"],
    })
      .notNull()
      .default("draft"),
    source: text("source", { enum: ["generation", "upload", "fork"] })
      .notNull()
      .default("generation"),
    brandKitOverridden: boolean("brand_kit_overridden")
      .notNull()
      .default(false),

    mediaType: text("media_type", { enum: ["image", "video"] })
      .notNull()
      .default("image"),
    model: text("model").notNull(),
    provider: text("provider").notNull(),
    prompt: text("prompt").notNull(),
    enhancedPrompt: text("enhanced_prompt"),
    parameters: jsonb("parameters").$type<Record<string, unknown>>(),
    r2Key: text("r2_key").notNull(),
    r2Url: text("r2_url").notNull(),
    thumbnailR2Key: text("thumbnail_r2_key"),
    width: integer("width"),
    height: integer("height"),
    fileSize: integer("file_size"),
    costEstimate: real("cost_estimate").notNull().default(0),
    duration: real("duration"),
    hasAudio: boolean("has_audio").default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("assets_user_id_idx").on(table.userId),
    index("assets_brand_id_idx").on(table.brandId),
    // Hot path for the review queue — counts pending per brand.
    index("assets_brand_status_idx").on(table.brandId, table.status),
    index("assets_parent_idx").on(table.parentAssetId),
    index("assets_model_idx").on(table.model),
    index("assets_media_type_idx").on(table.mediaType),
    index("assets_created_at_idx").on(table.createdAt),
  ]
);

// ============================================================
// DEPRECATED — asset_brands M2M junction.
// Replaced by `assets.brand_id` single FK in migration 0009.
// Table is dropped in migration 0010 once all consumers move off it.
// Kept in schema.ts so legacy queries compile during the transition; remove
// once `src/app/api/assets`, `src/app/api/brands`, and `src/lib/xp.ts` are
// migrated to the new model.
// ============================================================

export const assetBrands = pgTable(
  "asset_brands",
  {
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.assetId, table.brandId] })]
);

// ============================================================
// Asset M2M tags (free-form) and campaign joins
// ============================================================

export const assetTags = pgTable(
  "asset_tags",
  {
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.assetId, table.tag] }),
    index("asset_tags_tag_idx").on(table.tag),
  ]
);

export const assetCampaigns = pgTable(
  "asset_campaigns",
  {
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.assetId, t.campaignId] })]
);

// ============================================================
// Uploads — pairs with an `assets` row when source='upload'
// ============================================================

export const uploads = pgTable("uploads", {
  id: uuid("id").defaultRandom().primaryKey(),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => assets.id, { onDelete: "cascade" })
    .unique(),
  uploaderId: uuid("uploader_id")
    .notNull()
    .references(() => users.id),
  originalFilename: text("original_filename").notNull(),
  contentType: text("content_type").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============================================================
// Asset review log — every status transition writes one row (NFR-003)
// ============================================================

export const assetReviewLog = pgTable(
  "asset_review_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    action: text("action", {
      enum: [
        "submitted",
        "approved",
        "rejected",
        "archived",
        "unarchived",
        "forked",
        "moved_from_personal",
      ],
    }).notNull(),
    fromStatus: text("from_status", {
      enum: ["draft", "in_review", "approved", "rejected", "archived"],
    }),
    toStatus: text("to_status", {
      enum: ["draft", "in_review", "approved", "rejected", "archived"],
    }).notNull(),
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("review_log_asset_idx").on(t.assetId),
    index("review_log_actor_idx").on(t.actorId),
    index("review_log_created_at_idx").on(t.createdAt),
  ]
);

// ============================================================
// Generations (audit log linking a job to its asset)
// ============================================================

export const generations = pgTable(
  "generations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    model: text("model").notNull(),
    prompt: text("prompt").notNull(),
    enhancedPrompt: text("enhanced_prompt"),
    parameters: jsonb("parameters").$type<Record<string, unknown>>(),
    status: text("status", {
      enum: ["pending", "processing", "completed", "failed"],
    })
      .notNull()
      .default("pending"),
    errorMessage: text("error_message"),
    jobId: text("job_id"),
    assetId: uuid("asset_id").references(() => assets.id),
    costEstimate: real("cost_estimate").notNull().default(0),
    xpEarned: integer("xp_earned").notNull().default(0),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("generations_user_id_idx").on(table.userId),
    index("generations_status_idx").on(table.status),
    index("generations_created_at_idx").on(table.createdAt),
  ]
);

// ============================================================
// XP (Experience Points) — pre-existing; not gating in agency mode
// ============================================================

export const userXp = pgTable("user_xp", {
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })
    .unique(),
  xp: integer("xp").notNull().default(0),
  level: integer("level").notNull().default(1),
});

export const xpTransactions = pgTable(
  "xp_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    amount: integer("amount").notNull(),
    type: text("type", {
      enum: ["generation", "badge_reward", "admin_grant"],
    }).notNull(),
    description: text("description"),
    generationId: uuid("generation_id").references(() => generations.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("xp_tx_user_id_idx").on(table.userId),
    index("xp_tx_created_at_idx").on(table.createdAt),
  ]
);

// ============================================================
// Badges — pre-existing; cosmetic-only in agency mode
// ============================================================

export const badges = pgTable("badges", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  icon: text("icon").notNull(),
  category: text("category", {
    enum: ["milestone", "streak", "model", "quality", "video", "special"],
  }).notNull(),
  xpReward: integer("xp_reward").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
});

// ============================================================
// LoRA Favorites
// ============================================================

export const loraFavorites = pgTable(
  "lora_favorites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: text("source").notNull().default("civitai"),
    civitaiModelId: integer("civitai_model_id"),
    civitaiVersionId: integer("civitai_version_id"),
    hfRepoId: text("hf_repo_id"),
    name: text("name").notNull(),
    downloadUrl: text("download_url").notNull(),
    triggerWords: jsonb("trigger_words").$type<string[]>().default([]),
    previewImageUrl: text("preview_image_url"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("lora_favorites_user_id_idx").on(table.userId),
    index("lora_favorites_unique_idx").on(table.userId, table.civitaiVersionId),
    index("lora_favorites_user_source_idx").on(table.userId, table.source),
  ]
);

// ============================================================
// Brews (saved generation recipes; brand-lockable; 3-level visibility)
// ============================================================

export const brews = pgTable(
  "brews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    model: text("model").notNull(),
    prompt: text("prompt"),
    enhancedPrompt: text("enhanced_prompt"),
    parameters: jsonb("parameters").$type<Record<string, unknown>>(),
    previewUrl: text("preview_url"),
    imageInput: jsonb("image_input").$type<string[]>(),
    brandId: uuid("brand_id").references(() => brands.id, {
      onDelete: "set null",
    }),
    // FR-041: three-level visibility. Migration 0009 rewrites legacy `unlisted`
    // values to `brand`. The enum lists `unlisted` only so legacy code (Phase
    // 8c migrates the consumers) keeps compiling during the transition; the
    // value is dropped after T156–T158 land.
    visibility: text("visibility", {
      enum: ["private", "unlisted", "brand", "public"],
    })
      .notNull()
      .default("private"),
    // True when this brew is locked to its brand (editing forks a new draft).
    isLocked: boolean("is_locked").notNull().default(false),
    slug: text("slug").unique(),
    originalBrewId: uuid("original_brew_id"),
    originalUserId: uuid("original_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    usageCount: integer("usage_count").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("brews_user_id_idx").on(table.userId),
    index("brews_visibility_created_at_idx").on(
      table.visibility,
      table.createdAt
    ),
  ]
);

// ============================================================
// Brew visibility log (FR-043) — sibling table to asset_review_log.
// Asset transitions and brew visibility flips are different lifecycles.
// ============================================================

export const brewVisibilityLog = pgTable(
  "brew_visibility_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    brewId: uuid("brew_id")
      .notNull()
      .references(() => brews.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    fromVisibility: text("from_visibility", {
      enum: ["private", "brand", "public"],
    }),
    toVisibility: text("to_visibility", {
      enum: ["private", "brand", "public"],
    }).notNull(),
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("brew_visibility_log_brew_idx").on(t.brewId),
    index("brew_visibility_log_actor_idx").on(t.actorId),
    index("brew_visibility_log_created_at_idx").on(t.createdAt),
  ]
);

// ============================================================
// References (uploaded reference images; brand-pin via optional brandId)
// ============================================================

export const references = pgTable(
  "references",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Nullable — existing references stay user-scoped; brand kits pin via this.
    brandId: uuid("brand_id").references(() => brands.id, {
      onDelete: "set null",
    }),
    r2Key: text("r2_key").notNull(),
    r2Url: text("r2_url").notNull(),
    thumbnailR2Key: text("thumbnail_r2_key"),
    fileName: text("file_name"),
    fileSize: integer("file_size"),
    width: integer("width"),
    height: integer("height"),
    mimeType: text("mime_type").notNull(),
    usageCount: integer("usage_count").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("references_user_id_idx").on(table.userId),
    index("references_created_at_idx").on(table.createdAt),
  ]
);

export const userBadges = pgTable(
  "user_badges",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    badgeId: text("badge_id")
      .notNull()
      .references(() => badges.id),
    earnedAt: timestamp("earned_at").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.badgeId] })]
);

// ============================================================
// Phase 2 stubs — collections + asset_collections.
// Schema-only in MVP. The Phase 2 PR adds API + UI without migration churn.
// ============================================================

export const collections = pgTable(
  "collections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    shareSlug: text("share_slug").unique(),
    isPublic: boolean("is_public").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("collections_brand_idx").on(t.brandId)]
);

export const assetCollections = pgTable(
  "asset_collections",
  {
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.assetId, t.collectionId] })]
);
