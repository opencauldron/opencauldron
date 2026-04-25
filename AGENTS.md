<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Package manager

This project uses **Bun**, not npm. Use `bun install`, `bun run <script>`, and `bunx <bin>` (not `npm`/`npx`/`yarn`/`pnpm`). The canonical lockfile is `bun.lock` — `package-lock.json` and friends are gitignored to prevent drift.

# Changelog

User-facing changes must add an entry to the top of `CHANGELOG` in `src/lib/changelog.ts`. The sidebar's "What's New" popover reads from this array — shipping a feature without an entry means users won't know it landed.

- **What counts**: anything a user would notice — new features, redesigned UI, new providers/models, behavior changes, notable bug fixes. Skip pure refactors, internal scripts, and dependency bumps.
- **Format**: `{ date: "YYYY-MM-DD", title: "<short headline>", bullets: ["<plain-language change>", ...] }`. Newest entry goes first.
- **Voice**: write bullets for end users, not engineers. "Sidebar now collapses to an icon rail (⌘B)" — not "Added `collapsible='icon'` prop to Sidebar".
- **Trigger the unread dot**: bumping `date` to today auto-flags the change as unread for every user. No other state to manage.
- **Claude Code users**: invoke the `update-changelog` skill (in `.claude/skills/update-changelog/`) to draft the entry from recent commits. Other tools: follow the schema above and prepend manually.
