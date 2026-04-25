export type ChangelogEntry = {
  date: string;
  title: string;
  bullets: string[];
};

export const CHANGELOG: ChangelogEntry[] = [
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
