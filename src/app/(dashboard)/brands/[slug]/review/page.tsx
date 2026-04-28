/**
 * /brands/[slug]/review — forwards to the workspace review dashboard. The
 * dashboard auto-resolves the per-brand queue and the layout already filters
 * the Review tab off for non-managers, so this is a thin shim for now.
 */

import { redirect } from "next/navigation";

export default function BrandReviewPage() {
  redirect("/review");
}
