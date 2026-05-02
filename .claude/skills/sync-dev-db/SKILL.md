---
name: sync-dev-db
description: "Sync OpenCauldron's Neon `dev` branch with `main` (production) data, preserving the current dev state under a timestamped backup branch. Use this skill whenever the user wants to refresh, reset, or sync their dev database with production — phrasings include 'sync dev db', 'sync dev w prod', 'reset dev from prod', 'refresh dev', 'pull prod into dev', 'overwrite dev with prod', or any variant of getting the dev branch to match production. Trigger even if the user is casual or terse about it."
---

# Sync Dev DB with Production

Reset OpenCauldron's Neon `dev` branch to match `main` (production), preserving the current dev state under a backup branch first. This is the standard workflow when dev data has drifted from prod and the developer wants a clean copy of production to work against.

## Why this exists

OpenCauldron's database lives in the Neon project `studio` (`fancy-dew-30879013`):
- `main` (`br-icy-dew-akrikqdo`) — production
- `dev` (`br-lingering-firefly-akq151v9`) — development, child branch of `main`

Because `dev` is a Neon child branch of `main`, syncing is a one-shot `reset_from_parent` operation — no `pg_dump`/`pg_restore` needed. The whole thing takes seconds.

Past resets have followed a consistent pattern: timestamped backup branch (`dev-backup-YYYY-MM-DD`) before the reset, so any dev-only writes are recoverable for the project's history retention window.

## What to do

### 1. Confirm before proceeding

This destroys any writes on the `dev` branch since the last reset. Always show the user a one-line plan and wait for confirmation:

> "I'll preserve current dev as `dev-backup-<today>` and reset `dev` from `main` (production). Confirm?"

If the user has already explicitly said something unambiguous like "yes do it" or "sync without confirming," skip the prompt. Otherwise ask — the cost of a one-line check is low; the cost of nuking unsaved dev work is high.

### 2. Run the reset

Use the Neon MCP tool with these exact arguments:

```
mcp__Neon__reset_from_parent
  projectId:        fancy-dew-30879013
  branchIdOrName:   dev
  preserveUnderName: dev-backup-<today's date in YYYY-MM-DD>
```

Today's date should come from the system context (`currentDate`) — not a guess. The backup name pattern (`dev-backup-YYYY-MM-DD`) matters because previous backups follow it; sticking to the pattern keeps the Neon branch list scannable.

### 3. Report the outcome

Tell the user:
- That `dev` now mirrors `main` (production)
- The name of the backup branch they can recover from
- That backups are recoverable for ~6 hours (the project's `history_retention_seconds` is 21600)

Keep the report to one or two sentences. The user knows what they asked for; they want confirmation, not a recap.

## Edge cases

**Backup name collision** — if a backup with today's date already exists (the user already synced today), Neon will reject the `preserveUnderName`. In that case, append a suffix: `dev-backup-YYYY-MM-DD-2`, `-3`, etc. Don't silently overwrite.

**User on a non-default database name** — the OpenCauldron app uses the default `neondb`. If the user mentions a different database, double-check before proceeding; this skill assumes the standard setup.

**User wants the inverse (push dev → prod)** — that's a different operation entirely (and far more dangerous). Do not use this skill. Stop and ask the user to confirm intent; production writes need a real migration plan, not a branch reset.

**Project ID drift** — if `fancy-dew-30879013` ever stops resolving, list Neon projects (`mcp__Neon__list_projects`) and find the one named `studio`. Update this skill if the ID has actually changed.

## Don't

- Don't run `pg_dump`/`pg_restore` — Neon branching is the right tool here and it's faster.
- Don't skip the backup branch. The 30 seconds of "extra" work is the only undo path.
- Don't run this against any branch other than `dev` without explicit user instruction.
