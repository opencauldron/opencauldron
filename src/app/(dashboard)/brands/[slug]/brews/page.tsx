/**
 * /brands/[slug]/brews — placeholder. Forwards to the brews surface filtered
 * to this brand once the per-brand brews view ships in a follow-up phase.
 * For now we just redirect to the global /brews page so navigation completes.
 */

import { redirect } from "next/navigation";

export default async function BrandBrewsPage({
  params: _params,
}: {
  params: Promise<{ slug: string }>;
}) {
  void _params;
  redirect("/brews");
}
