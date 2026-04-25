---
name: update-changelog
description: "Add an entry to OpenCauldron's CHANGELOG (src/lib/changelog.ts) for a user-facing change. Use this skill when finishing a user-visible feature, before opening a PR, or when the user says 'update changelog', 'add to whats new', 'add a changelog entry', or 'log this for users'. Also trigger proactively at the end of any session that shipped UI/UX changes, new providers/models, behavior changes, or notable bug fixes — anything a user would notice in the app. Skip pure refactors, internal scripts, dependency bumps, or in-progress work that hasn't shipped."
---

# Update Changelog

This skill adds an entry to OpenCauldron's user-facing changelog. The sidebar's "What's New" popover reads from this array, so every meaningful change a user would notice belongs here.

## When to use

Use this skill when:
- Finishing a user-visible feature (new page, UI redesign, new model/provider, behavior change)
- The user explicitly asks to "update changelog" or "add to what's new"
- Wrapping up a session that shipped UI changes — offer it proactively before suggesting a commit

Skip when:
- The work is a pure refactor with no observable change
- Internal tooling, scripts, dev-only flags, dependency bumps
- Work hasn't actually shipped (still WIP, behind a feature flag)
- The change is a small fix that wouldn't be interesting to mention

## Where it lives

`src/lib/changelog.ts` — single source of truth. Schema:

```ts
export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "YYYY-MM-DD",
    title: "<short headline>",
    bullets: [
      "<plain-language change>",
      "<another plain-language change>",
    ],
  },
  // older entries below...
];
```

The newest entry goes **first**. The unread dot in the sidebar fires automatically when `getLatestChangelogDate()` is greater than the user's localStorage `WHATS_NEW_SEEN_KEY`, so just adding a new entry with today's date is enough — no other state to wire up.

## Process

1. **Gather context**. Run `git log --oneline -20` to see what's shipped recently. If a specific commit range or PR is in scope, look at that. Identify the user-visible changes — ignore internal-only commits.

2. **Group commits into one entry, not many**. Multiple commits that ship one coherent feature get a single changelog entry. Don't make one entry per commit. If the work was big enough to span multiple distinct features, that's two entries.

3. **Read the current file**. `src/lib/changelog.ts`. Note the current `date` of the top entry — if today's date already matches, you may be appending bullets to that entry rather than creating a new one (judgment call: same logical release? merge. Different feature shipped today? new entry).

4. **Draft the entry**:
   - **`date`**: today's date in `YYYY-MM-DD`. Check current date — don't guess.
   - **`title`**: one short headline. 3–6 words. Title-case the first word, sentence-case the rest. Examples: "Help menu and sidebar polish", "HuggingFace LoRA support", "Brew sharing".
   - **`bullets`**: 1–4 plain-language bullets. Write for end users, not engineers.
     - GOOD: "Sidebar now collapses to an icon rail (⌘B)"
     - BAD: "Added `collapsible='icon'` prop to Sidebar"
     - GOOD: "New 'What's New' menu shows recent changes with an unread indicator"
     - BAD: "Implemented WhatsNewMenuItem component using useSyncExternalStore"

5. **Insert at the top of `CHANGELOG`**. Use the Edit tool — match the existing formatting (2-space indent, trailing commas).

6. **Don't bump anything else**. The skill only touches `src/lib/changelog.ts`. The sidebar reads it automatically. Don't change `package.json` version (that's a separate decision tied to releases).

7. **Verify**. Quick sanity check:
   - File still parses (no syntax errors — Edit will catch most)
   - Top entry's date is the most recent
   - Bullets read like product copy, not commit messages
   - No accidental org names, internal codenames, or PII (see global rule about org names in public repos)

## Voice and style

- **Active, concrete, present-tense outcome**: "Sidebar collapses to an icon rail" not "Sidebar can now be collapsed".
- **No hedging**: "Improved performance" is filler. Either say what got faster, or omit.
- **No emojis** unless the user has emoji-style entries already in the file.
- **No markdown formatting inside bullets** — they render as plain text. No backticks, no bold.
- **Keyboard shortcuts in parens**: "(⌘B)", "(⌘K)".
- **Proper nouns capitalized**: HuggingFace, LoRA, GitHub, FAL, Replicate.

## Edge cases

- **Multiple distinct features in one session**: create multiple entries (one per feature) at the top, today's date on each. Order them by significance, biggest first.
- **A bug fix users were complaining about**: include it as its own entry or as a bullet — your call based on visibility. Use the title format "Fix: <what>" if it's a standalone entry.
- **Breaking change for self-hosters**: lead with it. Add a bullet that explains migration in one sentence and links to docs if a deeper guide exists.
- **The top entry is from today and you're adding more bullets**: append bullets to the existing entry rather than creating a duplicate-dated one. Keep bullets ordered by significance.
- **The user is in the middle of a multi-step feature**: don't add a changelog entry yet. Wait until the feature ships end-to-end.

## After updating

If the user is about to commit, the changelog change should be part of the same commit as the feature it describes — don't create a separate "update changelog" commit. If they've already committed the feature, a follow-up commit with `docs: add changelog entry for <feature>` is fine.

Don't tell the user to manually verify the entry shows up in the UI — `npm run dev` and click the sparkle icon in the sidebar's bottom group will show it.
