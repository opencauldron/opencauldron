# Plan: `/reassign-brand` — let users move assets between brands

## Why
Today the only brand-mutation endpoint is `POST /api/assets/[id]/move-to-brand`, which is locked to Personal → real-brand promotion by the asset's owner. There's no path for fixing a miscategorized asset or for a manager/admin to clean up a teammate's wrong brand assignment. We're replacing it with a single, broader endpoint and surfacing the action in the gallery's asset detail panel.

## Scope (single-asset, v1)
- Replace `/move-to-brand` with `/reassign-brand` (no other callers exist; UI hadn't shipped a callsite yet).
- Add a "Move to brand…" action in the asset detail panel inside `gallery-client.tsx`.
- No bulk-move in v1.

---

## Permission rules (final)

| Actor | Can reassign? |
|---|---|
| Asset creator (`assets.user_id = me`) | ✅ |
| `brand_manager` on **source** brand | ✅ |
| Workspace `admin` or `owner` (`isWorkspaceAdmin`) | ✅ |
| Anyone else | ❌ |

Plus, on **destination**:
- Caller must be `creator+` on destination (`canCreateAsset`).
- Destination must be **non-Personal**, same workspace as source.
- Destination must differ from source.

**Hard block:** `approved` assets cannot be moved. Response: `{ error: "approved_immutable_fork_required" }` 409. Caller must fork first.

**Status reset:** on success, `assets.status` → `'draft'`. (New brand may have different review standards. Same behavior the old `/move-to-brand` used.)

---

## File-by-file changes

### 1. `src/lib/db/schema.ts` — audit-action enum
Add a new value `moved_brand` to the audit-event enum. Keep `moved_from_personal` (historical rows still reference it).

```ts
// existing pgEnum for audit_action
pgEnum("audit_action", [
  // ...existing values...
  "moved_from_personal", // dead but retained for historical rows
  "moved_brand",         // NEW
]);
```

After editing, run `pnpm db:push` against the dev branch to add the enum value.

### 2. `src/lib/transitions.ts` — type union
Extend the audit `action` union to include `moved_brand`. Update the `logReviewEvent` JSDoc comment listing valid non-status events.

### 3. `src/app/api/assets/[id]/reassign-brand/route.ts` — NEW
Implements `POST` with this contract:

**Request body:** `{ brandId: string (uuid) }`

**Behavior:**
1. `auth()` — 401 if no session.
2. Load asset + source brand (`assetId`, `userId`, `status`, `sourceBrandId`, `sourceWorkspaceId`, `sourceIsPersonal`, `sourceOwnerId`, `sourceBrandName`).
3. Reject:
   - Asset not found → 404 `asset_not_found`.
   - `status === 'approved'` → 409 `approved_immutable_fork_required`.
   - Source has no workspace_id (data invariant) → 500.
4. Permission gate on **source**:
   - Allow if `assets.user_id === me` (asset creator).
   - Allow if `isBrandManager(ctx, sourceBrandId)` on source workspace.
   - Allow if `isWorkspaceAdmin(ctx)` on source workspace.
   - Else → 403 `forbidden`.
5. Load destination via `loadBrandContext(targetBrandId)`:
   - Not found → 404 `target_brand_not_found`.
   - Cross-workspace → 403 `cross_workspace_move_forbidden`.
   - Personal destination → 400 `target_must_be_real_brand`.
   - Same as source → 400 `target_same_as_source`.
6. Permission gate on **destination**: `canCreateAsset(destCtx, destBrandCtx)` else 403.
7. Two-step write (Neon HTTP driver lacks `db.transaction`):
   ```ts
   await db.update(assets).set({
     brandId: targetBrandId,
     status: "draft",
     updatedAt: new Date(),
   }).where(eq(assets.id, assetId));

   await logReviewEvent({
     assetId,
     actorId: userId,
     action: "moved_brand",
     fromStatus: assetStatus,
     toStatus: "draft",
     metadata: { fromBrandId: sourceBrandId, toBrandId: targetBrandId },
   });
   ```
   If `logReviewEvent` accepts metadata, include `fromBrandId` / `toBrandId`. If it doesn't (audit table only stores `from_status`/`to_status`), check whether the audit table has a brand_id column we can populate, or extend it (don't extend — too much scope creep; just rely on `from_status: previous`, `to_status: 'draft'`, and link to brand via fresh queries if a future audit query needs it).

   **TODO at implementation time:** read `transitions.ts` `logReviewEvent` signature and the audit table schema (`asset_review_log`) to decide what brand metadata can be persisted. If neither supports brand fields, leave a comment noting the limitation and rely on the asset's current `brand_id` plus the audit timestamp ordering.

8. Response: `{ asset: { id, brandId: targetBrandId, status: 'draft' } }` 200.

### 4. `src/app/api/assets/[id]/move-to-brand/route.ts` — DELETE the file
No callers in the codebase. The new endpoint subsumes its semantics.

### 5. `src/app/(dashboard)/gallery/gallery-client.tsx` — UI

**Component-level state additions:**
```ts
const [reassignOpen, setReassignOpen] = useState(false);
const [reassignTargetBrandId, setReassignTargetBrandId] = useState("");
const [reassigning, setReassigning] = useState(false);
```

**Permission check (client-side, advisory — server is the source of truth):**
- Need to know my role: workspace role + `brand_memberships`. Already loaded via `/api/me` (used elsewhere in gallery-client). If not, fetch on mount.
- Show "Move to brand…" if any of:
  - `selectedAsset.userId === me.id`
  - my brand role on `selectedAsset.brandId` is `brand_manager`
  - my workspace role is `owner` or `admin`
- Hide if `selectedAsset.status === 'approved'`. (Disable + tooltip is also fine; hide is simpler.)

**Render placement:** In the asset detail panel (the existing `Sheet` that opens for `selectedAsset`), in the action row near Submit / Fork. Insert before "Save as Brew" so it sits with the brand-related actions.

**Inline picker UI (recommended over modal-on-modal):**
- Toggled by clicking "Move to brand…".
- When open, shows:
  - `<Select>` of eligible destinations: `allBrands.filter(b => !b.isPersonal && b.id !== selectedAsset.brandId)` further filtered to brands where `me` is `creator+` (use brand membership map; admins see all).
  - Warning banner if `selectedAsset.status === 'in_review'`: *"Moving this asset will reset its status to draft and require resubmission."*
  - Buttons: `Cancel` / `Move` (primary). Primary disabled until target chosen.

**Confirm handler:**
```ts
async function handleReassign() {
  if (!selectedAsset || !reassignTargetBrandId) return;
  setReassigning(true);
  try {
    const res = await fetch(`/api/assets/${selectedAsset.id}/reassign-brand`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brandId: reassignTargetBrandId }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const map: Record<string, string> = {
        approved_immutable_fork_required: "Approved assets must be forked, not moved.",
        target_must_be_real_brand: "Personal brands can't be a destination.",
        target_same_as_source: "Asset is already on that brand.",
        cross_workspace_move_forbidden: "Can't move assets between workspaces.",
        forbidden: "You don't have permission to move this asset.",
      };
      toast.error(map[body.error] ?? `Couldn't move: ${body.error ?? res.statusText}`);
      return;
    }
    const targetBrand = allBrands.find((b) => b.id === reassignTargetBrandId);
    toast.success(`Moved to ${targetBrand?.name ?? "brand"}.`);
    // Patch local state without a full refetch.
    setAssets((prev) =>
      prev.map((a) =>
        a.id === selectedAsset.id
          ? {
              ...a,
              brandId: reassignTargetBrandId,
              status: "draft",
              brand: targetBrand
                ? { id: targetBrand.id, name: targetBrand.name, color: targetBrand.color, isPersonal: targetBrand.isPersonal }
                : null,
              brands: targetBrand ? [targetBrand] : [],
            }
          : a
      )
    );
    setSelectedAsset((prev) =>
      prev && prev.id === selectedAsset.id
        ? { ...prev, brandId: reassignTargetBrandId, status: "draft", brand: targetBrand ? { id: targetBrand.id, name: targetBrand.name, color: targetBrand.color, isPersonal: targetBrand.isPersonal } : null, brands: targetBrand ? [targetBrand] : [] }
        : prev
    );
    // If a brand filter is locked (we're on /brands/[slug]/gallery) and we just
    // moved out of that brand, the asset will fall out of the list on next
    // refetch — drop it now for visual coherence.
    if (lockedBrandId && reassignTargetBrandId !== lockedBrandId) {
      setAssets((prev) => prev.filter((a) => a.id !== selectedAsset.id));
    }
    setReassignOpen(false);
    setReassignTargetBrandId("");
  } finally {
    setReassigning(false);
  }
}
```

**Important:** the `/api/brands` endpoint already returns either all workspace brands (admin) or my member brands (others). Use the existing `allBrands` state; no new fetch needed.

### 6. Verify build & types
```
pnpm exec tsc --noEmit
pnpm build  # optional, for pages that import schema enum
```

### 7. Smoke test (dev)
- As Adam (workspace owner): open an asset on Personal, "Move to brand…" → GIDDI. Asset card now shows GIDDI dot, status `draft`, audit row written.
- Approved asset: button hidden (or disabled with tooltip).
- Bad destination (Personal in picker): not in list.
- Reassign across workspaces: not reachable from UI; verify endpoint rejects via curl.

### 8. Changelog
Add to top of `CHANGELOG` in `src/lib/changelog.ts`:
```ts
{
  date: "2026-04-27",
  title: "Move assets between brands",
  bullets: [
    "Asset detail panel now has a 'Move to brand…' action so a miscategorized asset can be reassigned to the correct brand.",
    "Available to the asset's creator, brand managers on the source brand, and workspace admins. Approved assets must still be forked, not moved.",
    "Moving an asset resets its status to draft so the new brand's reviewers can vet it.",
  ],
},
```

---

## Out of scope (not in this PR)
- Bulk move (multi-select grid action).
- Personal as destination.
- Cross-workspace moves.
- Moving approved assets without forking.
- Migrating away from the dead `moved_from_personal` enum value.

---

## Implementation order
1. Schema enum + push to dev.
2. `transitions.ts` type union.
3. New route file.
4. Delete old route file.
5. UI changes in `gallery-client.tsx`.
6. Type-check.
7. Manual smoke in browser at `localhost:9999`.
8. Changelog.
