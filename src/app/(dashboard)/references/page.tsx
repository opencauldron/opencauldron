/**
 * Legacy `/references` page → permanent redirect to `/library` (US1 / T020).
 *
 * Spec FR-007 calls for a 301; Next.js's App Router `redirect()` defaults to
 * 307 (temporary). `permanentRedirect()` emits 308 (permanent), which is
 * 301's modern semantic equivalent — preserves method + body across the
 * redirect, which the bare-GET use-case here doesn't need but costs nothing.
 *
 * Query params are preserved verbatim so deep links and bookmarks keep
 * working. The directory and the `/api/references*` proxy routes (T021) are
 * intentionally left in place for the compat-shim window; Phase 6 (T045)
 * removes them.
 */

import { permanentRedirect } from "next/navigation";

export default async function ReferencesRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) qs.append(key, v);
    } else {
      qs.set(key, value);
    }
  }
  const search = qs.toString();
  permanentRedirect(search ? `/library?${search}` : "/library");
}
