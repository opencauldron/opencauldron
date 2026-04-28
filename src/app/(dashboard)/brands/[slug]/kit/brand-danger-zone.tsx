"use client";

/**
 * Brand "Danger Zone" — destructive actions card that lives at the bottom of
 * the brand kit page. Renders only for non-personal brands when the caller
 * is brand_manager+ (the parent server component enforces both gates).
 *
 * Deleting redirects back to /brands so the caller doesn't sit on a 404
 * after the brand row is gone.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DeleteBrandModal,
  type DeleteBrandReassignTarget,
  type DeleteBrandTarget,
} from "@/components/delete-brand-modal";

interface BrandDangerZoneProps {
  brand: DeleteBrandTarget;
  availableTargets: DeleteBrandReassignTarget[];
}

export function BrandDangerZone({
  brand,
  availableTargets,
}: BrandDangerZoneProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <section
      aria-labelledby="brand-danger-zone"
      className="max-w-2xl rounded-lg border border-destructive/50 bg-destructive/5 p-4"
    >
      <h2
        id="brand-danger-zone"
        className="text-sm font-semibold text-destructive"
      >
        Danger Zone
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Deleting this brand removes its members, campaigns, collections, and
        review history. You can move its assets and brews to another brand
        first, or delete them along with the brand.
      </p>
      <div className="mt-3 flex justify-end">
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setOpen(true)}
        >
          Delete brand
        </Button>
      </div>
      <DeleteBrandModal
        open={open}
        brand={brand}
        availableTargets={availableTargets}
        onClose={() => setOpen(false)}
        onDeleted={() => router.push("/brands")}
      />
    </section>
  );
}
