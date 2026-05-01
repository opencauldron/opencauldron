-- 0019_thread_storage_counter.sql
--
-- ⚠️  DRAFTED, NOT APPLIED. Phase 6 / T054. The user runs this on a Neon
-- preview branch when (and only when) the v1 SUM-aggregation hot-path in
-- `src/lib/threads/storage-quota.ts` proves to be a real performance
-- problem. Until then this migration is unused and the journal has not
-- been bumped.
--
-- v1 implementation: every upload runs a SUM(file_size) over the trailing
-- 24h of `message_attachments` joined to `messages`. Cheap when each user
-- posts O(100s) of attachments per day, expensive when the table grows
-- unbounded.
--
-- v2 plan (this migration): a small rolling-window counter table updated
-- on every upload. The counter is keyed by user_id only — a single row
-- per user — and stores `bytes_in_window` + `oldest_in_window_at`. A
-- nightly sweeper resets rows whose `oldest_in_window_at < now() - 24h`
-- back to 0 (or rebuilds the SUM if `bytes_in_window > 0` for that user).
--
-- Reversibility: `DROP TABLE thread_user_storage_counters` is the
-- complete rollback. No data dependencies in other tables.

CREATE TABLE thread_user_storage_counters (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bytes_in_window bigint NOT NULL DEFAULT 0,
  oldest_in_window_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Range scan: find users whose window has fully aged out so the sweeper
-- can zero them out efficiently.
CREATE INDEX thread_user_storage_counters_oldest_idx
  ON thread_user_storage_counters (oldest_in_window_at)
  WHERE oldest_in_window_at IS NOT NULL;
