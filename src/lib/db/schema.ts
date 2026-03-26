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
// Brands
// ============================================================

export const brands = pgTable("brands", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  color: text("color").notNull().default("#6366f1"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============================================================
// Assets (generated images and videos)
// ============================================================

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
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
    duration: real("duration"), // video duration in seconds
    hasAudio: boolean("has_audio").default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("assets_user_id_idx").on(table.userId),
    index("assets_model_idx").on(table.model),
    index("assets_media_type_idx").on(table.mediaType),
    index("assets_created_at_idx").on(table.createdAt),
  ]
);

// ============================================================
// Asset <-> Brand junction
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
// Asset tags (freeform topic tags)
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

// ============================================================
// Generations (audit log)
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
    jobId: text("job_id"), // provider job ID for async polling
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
// XP (Experience Points)
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
// Badges
// ============================================================

export const badges = pgTable("badges", {
  id: text("id").primaryKey(), // e.g. "first-spark"
  name: text("name").notNull(),
  description: text("description").notNull(),
  icon: text("icon").notNull(), // Lucide icon name e.g. "Sparkles"
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
    civitaiModelId: integer("civitai_model_id").notNull(),
    civitaiVersionId: integer("civitai_version_id").notNull(),
    name: text("name").notNull(),
    downloadUrl: text("download_url").notNull(),
    triggerWords: jsonb("trigger_words").$type<string[]>().default([]),
    previewImageUrl: text("preview_image_url"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("lora_favorites_user_id_idx").on(table.userId),
    index("lora_favorites_unique_idx").on(table.userId, table.civitaiVersionId),
  ]
);

// ============================================================
// Brews (saved generation recipes)
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
    imageInput: text("image_input"),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
    usageCount: integer("usage_count").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("brews_user_id_idx").on(table.userId),
  ]
);

// ============================================================
// References (uploaded reference images)
// ============================================================

export const references = pgTable(
  "references",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
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
  (table) => [
    primaryKey({ columns: [table.userId, table.badgeId] }),
  ]
);
