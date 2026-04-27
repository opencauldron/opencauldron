export type ChangelogEntry = {
  date: string;
  title: string;
  bullets: string[];
};

export const CHANGELOG: ChangelogEntry[] = [
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
