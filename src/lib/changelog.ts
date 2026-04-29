export type ChangelogEntry = {
  date: string;
  title: string;
  bullets: string[];
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-04-29",
    title: "Prompt enhancer, redesigned",
    bullets: [
      "Enhance now lives inside the prompt box — one tap rewrites your prompt in place, no extra panel to expand",
      "Hit Cmd/Ctrl+E to rewrite without leaving the keyboard",
      "Don't love the rewrite? An Undo pill appears for 8 seconds to put your original prompt back",
      "Click the ▾ next to Enhance for templates (style, lighting, composition, mood, quality) — selections clear after each run so they don't pile up",
      "On phones the options open as a bottom sheet for easier tapping",
    ],
  },
  {
    date: "2026-04-29",
    title: "Prompt enhancement is live again",
    bullets: [
      "Click ✨ Enhance on the prompt box to rewrite your idea into a more detailed prompt",
      "Powered by Mistral — set MISTRAL_API_KEY in your env to enable it",
      "Tuned per model — gpt-image, Imagen, Flux, and video providers get model-specific phrasing tips",
    ],
  },
  {
    date: "2026-04-29",
    title: "Cleaner error messages",
    bullets: [
      "When a provider rejects a generation, the toast now shows the actual reason instead of the raw API response",
      "Your prompt and signed asset URLs stay out of error messages",
      "Applied across every image and video model",
    ],
  },
  {
    date: "2026-04-29",
    title: "OpenAI image editing",
    bullets: [
      "OpenAI gpt-image models can now edit existing images — drop a reference into Generate and they'll follow your edit prompt directly",
      "Up to four reference images at once for compositing — describe how each should be used in your prompt",
      "gpt-image-1 and gpt-image-1.5 use high input fidelity automatically, tuned to preserve faces and fine detail across edits",
      "Defaults updated to follow OpenAI's prompting guide — medium quality and opaque backgrounds for more consistent results",
    ],
  },
  {
    date: "2026-04-29",
    title: "OpenAI gpt-image-2",
    bullets: [
      "OpenAI's newest image model is now available — sharper instruction-following and higher-fidelity image inputs",
      "Picked automatically when you select OpenAI in Generate; older versions (1.5, 1.0, Mini) live under the variant selector",
      "Heads up: gpt-image-2 doesn't support transparent backgrounds yet — use 1.5 if you need an alpha channel",
    ],
  },
  {
    date: "2026-04-29",
    title: "In-app notifications",
    bullets: [
      "New bell in the sidebar shows submits, approvals, and rejections as they happen",
      "Unread count pill on the bell, with a 'Mark all read' action in the popover",
      "Click a notification to jump straight to the brand's review queue",
      "XP, level-ups, and badge unlocks now toast after every successful generation",
    ],
  },
  {
    date: "2026-04-28",
    title: "Delete brands you no longer need",
    bullets: [
      "Brand managers can now delete a brand from the brands list (⋯ menu on each row) or from the brand's settings page (new Danger Zone)",
      "When deleting, choose what happens to the brand's assets and brews: move them to another brand, or delete them along with the brand",
      "Type the brand's name to confirm — same pattern as GitHub repo deletes",
      "Personal brands are hidden from this flow — they're system-managed and stay tied to your account",
      "The brands list also stops showing other teammates' Personal brands; you only see your own",
    ],
  },
  {
    date: "2026-04-27",
    title: "Home page with quick actions",
    bullets: [
      "Renamed Overview to Home — same page, friendlier name",
      "New action strip up top: Text → Image, Image → Image, Text → Video, Animate",
      "Each tile drops you into Generate with the right mode preselected — Image → Image even picks Flux Kontext for you and opens the reference picker",
    ],
  },
  {
    date: "2026-04-27",
    title: "Move assets between brands",
    bullets: [
      "Asset detail panel now has a 'Move to brand…' action so a miscategorized asset can be reassigned to the correct brand",
      "Available to the asset's creator, brand managers on the source brand, and workspace admins — approved assets must still be forked, not moved",
      "Moving an asset resets its status to draft so the new brand's reviewers can vet it",
    ],
  },
  {
    date: "2026-04-27",
    title: "Workspaces are now Studios",
    bullets: [
      "Renamed Workspace to Studio across the app — same thing, friendlier name",
      "New Studio settings page at /settings/studio for renaming, changing the slug, or pinning a logo URL",
      "The sidebar studio row now clicks straight through to Studio settings",
    ],
  },
  {
    date: "2026-04-27",
    title: "Campaigns",
    bullets: [
      "Group assets by initiative — create campaigns under any brand from /brands/[slug]/campaigns",
      "Brand managers can create, rename, or delete campaigns",
      "API for tagging assets with campaigns is live; gallery filter chip ships next",
    ],
  },
  {
    date: "2026-04-27",
    title: "Three-level brew visibility",
    bullets: [
      "Brews are now Private (just you), Brand (everyone on the brand), or Public (Explore tab)",
      "Promoting a brew to Public still requires a brand manager — creators can flip Private↔Brand on their own",
      "Every visibility change is logged so you can see who shared what and when",
    ],
  },
  {
    date: "2026-04-27",
    title: "Brand-first sidebar + workspace overview",
    bullets: [
      "Sidebar reorganized — Overview, Personal, Review, then a brand list with one row per client/division",
      "New /overview page shows your drafts, your pending review queue, recently approved work, and personal stats",
      "Workspace switcher up top for users in multiple workspaces (hosted only)",
      "+ Add brand button for workspace admins; new brands land with a kit you can edit at /brands/[slug]/kit",
      "Per-brand pages live at /brands/[slug]/{gallery,brews,kit,members,review}",
    ],
  },
  {
    date: "2026-04-27",
    title: "Brand kit panel on the generate page",
    bullets: [
      "See exactly what your brand kit will inject before you submit — prefix, suffix, banned terms, default LoRAs, anchor refs",
      "Override toggle dims the panel and skips kit injection for one-off generations",
      "Personal brands skip the panel; their kit is empty by design",
    ],
  },
  {
    date: "2026-04-27",
    title: "Drag-and-drop uploads",
    bullets: [
      "New Upload button in the gallery — drop existing photos or short videos straight in",
      "Up to 50MB per file; supports PNG, JPEG, WebP, GIF, MP4, MOV, WebM",
      "Uploads land as drafts on the brand you pick, ready for the review pipeline",
      "Per-file progress with a cancel button — no surprise stuck uploads",
    ],
  },
  {
    date: "2026-04-27",
    title: "Gallery now scoped to your brands",
    bullets: [
      "Status badges on every tile — draft, in review, approved, rejected, archived",
      "Filter the gallery by status or brand; filters survive in the URL so you can deep-link a view",
      "You only see assets you created or that live on a brand you're a member of",
      "Empty states distinguish 'no matches' from 'no access to this brand'",
    ],
  },
  {
    date: "2026-04-27",
    title: "Review queue (early access)",
    bullets: [
      "New Review tab in the sidebar with a pending-count badge for brand managers",
      "Submit a draft for review from the asset detail dialog — your brand manager picks it up from the queue",
      "Keyboard-driven approve/reject modal: j/k to walk the queue, a to approve, r to reject, n for a note",
      "Approved assets are now immutable — use Edit / Fork to start a new draft from an approved version",
      "Personal-brand assets stay out of the review pipeline as expected",
    ],
  },
  {
    date: "2026-04-26",
    title: "License updated to Sustainable Use License v1.0",
    bullets: [
      "OpenCauldron is now under the Sustainable Use License v1.0 (the same license used by n8n)",
      "Free for your own internal business use, non-commercial use, and personal use",
      "Free distribution permitted for non-commercial purposes",
      "Commercial hosting as a competing service requires a separate agreement",
    ],
  },
  {
    date: "2026-04-25",
    title: "OpenAI image models",
    bullets: [
      "Added gpt-image-1.5, gpt-image-1, and gpt-image-1-mini",
      "Native transparent PNG output for product and logo work",
      "Add OPENAI_API_KEY to .env to enable",
    ],
  },
  {
    date: "2026-04-25",
    title: "Help menu and sidebar polish",
    bullets: [
      "New Help menu with Documentation, Report a bug, and About",
      "Sidebar now collapses to an icon rail (⌘B)",
      "Reorganized navigation — account & admin moved to the bottom",
    ],
  },
  {
    date: "2026-04-24",
    title: "Brew sharing",
    bullets: [
      "Public brew pages with shareable links",
      "Browse and remix community brews from the Brews tab",
    ],
  },
  {
    date: "2026-04-22",
    title: "HuggingFace LoRA support",
    bullets: [
      "Browse and load LoRAs directly from HuggingFace",
      "Improved LoRA browser with search and filtering",
    ],
  },
];

export const FULL_CHANGELOG_URL =
  "https://github.com/opencauldron/opencauldron/blob/main/CHANGELOG.md";

export const WHATS_NEW_SEEN_KEY = "opencauldron:whats-new-seen";

export function getLatestChangelogDate(): string {
  return CHANGELOG[0]?.date ?? "";
}
