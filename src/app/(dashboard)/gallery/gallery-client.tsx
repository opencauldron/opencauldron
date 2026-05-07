"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Search,
  Trash2,
  Calendar,
  X,
  ImageIcon,
  Loader2,
  Play,
  Volume2,
  Clock,
  Wand2,
  FlaskConical,
  ImagePlus,
  Send,
  GitFork,
  Video,
  Upload,
  ArrowRightLeft,
  MessageSquareText,
} from "lucide-react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useRouter, useSearchParams } from "next/navigation";
import { normalizeImageInputs } from "@/lib/normalize-image-inputs";
import {
  ASSET_STATUSES,
  STATUS_LABELS,
  StatusBadge,
  type AssetStatus,
} from "@/components/status-badge";
import {
  UploadDropzone,
  type UploadedAsset,
} from "@/components/upload-dropzone";
import { BrandMark } from "@/components/brand-mark";
import { AssetDownloadButton } from "@/components/library/asset-download-button";
import { ThreadPanel } from "@/components/threads/thread-panel";

const PROVIDER_LABELS: Record<string, string> = {
  google: "Gemini",
  xai: "Grok",
  bfl: "Flux",
  ideogram: "Ideogram",
  recraft: "Recraft",
  runway: "Runway",
  fal: "Kling",
  minimax: "Hailuo",
  luma: "Luma",
};

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

interface AssetBrand {
  id: string;
  name: string;
  color: string;
  isPersonal?: boolean;
  logoUrl?: string | null;
  ownerImage?: string | null;
}

interface AssetUser {
  name: string | null;
  email: string | null;
  image: string | null;
}

interface GalleryAsset {
  id: string;
  userId: string;
  brandId: string | null;
  status: AssetStatus | null;
  parentAssetId: string | null;
  mediaType: string;
  model: string;
  provider: string;
  prompt: string;
  enhancedPrompt: string | null;
  parameters: Record<string, unknown> | null;
  url: string;
  thumbnailUrl: string;
  width: number | null;
  height: number | null;
  fileSize: number | null;
  costEstimate: number;
  duration: number | null;
  hasAudio: boolean | null;
  createdAt: string;
  /** Single canonical brand from `assets.brand_id` (FR-007). */
  brand: AssetBrand | null;
  /** Legacy multi-brand shape — `[brand]` if brand is set, else `[]`. */
  brands: AssetBrand[];
  tags: string[];
  user: AssetUser;
  // webp-image-delivery (PR 1) — hydrated by /api/assets and /api/assets/[id].
  // `webpUrl` is null until the encoder runs (or for video assets, which never
  // get a WebP). `originalFileSize` is the same value as `fileSize`, surfaced
  // explicitly so the dual-format download menu reads symmetrically.
  webpUrl: string | null;
  webpFileSize: number | null;
  webpStatus: "pending" | "ready" | "failed" | null;
  originalMimeType: string | null;
  originalFileSize: number | null;
}

const MODEL_OPTIONS = [
  { value: "", label: "All Models" },
  { value: "imagen-4", label: "Imagen 4" },
  { value: "imagen-flash", label: "Imagen Flash" },
  { value: "imagen-flash-lite", label: "Imagen Lite" },
  { value: "grok-imagine", label: "Grok Imagine" },
  { value: "grok-imagine-pro", label: "Grok Pro" },
  { value: "flux-1.1-pro", label: "Flux Pro" },
  { value: "flux-dev", label: "Flux Dev" },
  { value: "ideogram-3", label: "Ideogram 3" },
  { value: "recraft-v3", label: "Recraft V3" },
  { value: "recraft-20b", label: "Recraft 20B" },
  { value: "veo-3", label: "Veo 3" },
  { value: "runway-gen4-turbo", label: "Gen-4 Turbo" },
  { value: "kling-2.1", label: "Kling 2.1" },
  { value: "hailuo-2.3", label: "Hailuo 2.3" },
  { value: "ray-2", label: "Ray 2" },
];

const MEDIA_TYPE_OPTIONS = [
  { value: "", label: "All Media" },
  { value: "image", label: "Images" },
  { value: "video", label: "Videos" },
];

// -------------------------------------------------------------------
// Main Gallery Component
// -------------------------------------------------------------------

/**
 * Viewer info threaded through to the asset Dialog's Thread tab. Mirrors
 * `LibraryViewer` from `library-client.tsx` — sourced from the server-side
 * session in `page.tsx` so the client doesn't have to re-resolve it.
 */
export interface GalleryViewer {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
}

interface GalleryClientProps {
  /**
   * When set, the brand filter is locked to this id: the brand selector is
   * hidden, the URL no longer carries `?brand=`, and Clear-filters keeps it.
   * Used by /brands/[slug]/gallery so the brand layout's tab nav stays visible.
   */
  lockedBrandId?: string;
  viewer: GalleryViewer;
}

export function GalleryClient({ lockedBrandId, viewer }: GalleryClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [assets, setAssets] = useState<GalleryAsset[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<GalleryAsset | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Save as Brew
  const [brewAsset, setBrewAsset] = useState<GalleryAsset | null>(null);
  const [brewName, setBrewName] = useState("");
  const [brewDescription, setBrewDescription] = useState("");
  const [brewIncludePrompt, setBrewIncludePrompt] = useState(true);
  const [isSavingBrew, setIsSavingBrew] = useState(false);

  // Brands the current user can see (workspace-scoped via /api/brands).
  const [allBrands, setAllBrands] = useState<AssetBrand[]>([]);

  // Upload dialog (T122) — brand picker + dropzone. Default brand prefers the
  // current `brandFilter`, then falls back to the user's first brand.
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadBrandId, setUploadBrandId] = useState<string>("");

  // Reassign-brand inline picker (asset detail panel). Server is the source of
  // truth on permissions; this advisory state just hides the action when the
  // caller has no chance of succeeding.
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignTargetBrandId, setReassignTargetBrandId] = useState("");
  const [reassigning, setReassigning] = useState(false);
  const [me, setMe] = useState<{
    userId: string | null;
    role: "owner" | "admin" | "member" | null;
    brandRoles: Record<string, "brand_manager" | "creator" | "viewer">;
  }>({ userId: null, role: null, brandRoles: {} });

  useEffect(() => {
    fetch("/api/brands")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setAllBrands(data);
      })
      .catch(() => {});
    fetch("/api/me")
      .then((r) => r.json())
      .then((data) => {
        setMe({
          userId: data?.userId ?? null,
          role: data?.role ?? null,
          brandRoles: data?.brandRoles ?? {},
        });
      })
      .catch(() => {});
  }, []);

  // Filters — initial values seeded from URL so deep-links (and back/forward
  // navigation) round-trip cleanly. Filters are URL-state for the lifetime of
  // the page; we mirror them back into searchParams every time they change.
  const [modelFilter, setModelFilter] = useState(
    () => searchParams.get("model") ?? ""
  );
  const [mediaTypeFilter, setMediaTypeFilter] = useState(
    () => searchParams.get("mediaType") ?? ""
  );
  const [statusFilter, setStatusFilter] = useState<AssetStatus | "">(
    () => (searchParams.get("status") as AssetStatus | null) ?? ""
  );
  const [brandFilter, setBrandFilter] = useState<string>(
    () => lockedBrandId ?? searchParams.get("brand") ?? ""
  );
  const [searchQuery, setSearchQuery] = useState(
    () => searchParams.get("search") ?? ""
  );
  const [dateFrom, setDateFrom] = useState(() => searchParams.get("from") ?? "");
  const [dateTo, setDateTo] = useState(() => searchParams.get("to") ?? "");

  const observerRef = useRef<HTMLDivElement>(null);

  // Sync filter state to the URL (replace, not push, so each keystroke doesn't
  // bloat history). useEffect dependency tracks the canonical filter set.
  useEffect(() => {
    const next = new URLSearchParams();
    if (modelFilter) next.set("model", modelFilter);
    if (mediaTypeFilter) next.set("mediaType", mediaTypeFilter);
    if (statusFilter) next.set("status", statusFilter);
    if (brandFilter && !lockedBrandId) next.set("brand", brandFilter);
    if (searchQuery.trim()) next.set("search", searchQuery.trim());
    if (dateFrom) next.set("from", dateFrom);
    if (dateTo) next.set("to", dateTo);
    const qs = next.toString();
    const url = qs ? `?${qs}` : window.location.pathname;
    window.history.replaceState(null, "", url);
  }, [
    modelFilter,
    mediaTypeFilter,
    statusFilter,
    brandFilter,
    searchQuery,
    dateFrom,
    dateTo,
  ]);

  const buildQuery = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams();
      if (modelFilter) params.set("model", modelFilter);
      if (mediaTypeFilter) params.set("mediaType", mediaTypeFilter);
      if (statusFilter) params.set("status", statusFilter);
      if (brandFilter) params.set("brand", brandFilter);
      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      if (cursor) params.set("cursor", cursor);
      params.set("limit", "30");
      return params.toString();
    },
    [modelFilter, mediaTypeFilter, statusFilter, brandFilter, searchQuery]
  );

  const fetchAssets = useCallback(
    async (cursor?: string) => {
      try {
        const query = buildQuery(cursor);
        const res = await fetch(`/api/assets?${query}`);
        if (!res.ok) throw new Error("Failed to fetch assets");
        const data = await res.json();

        let filtered = data.assets as GalleryAsset[];
        if (dateFrom) {
          const from = new Date(dateFrom);
          filtered = filtered.filter((a) => new Date(a.createdAt) >= from);
        }
        if (dateTo) {
          const to = new Date(dateTo);
          to.setHours(23, 59, 59, 999);
          filtered = filtered.filter((a) => new Date(a.createdAt) <= to);
        }

        if (cursor) {
          setAssets((prev) => [...prev, ...filtered]);
        } else {
          setAssets(filtered);
        }
        setNextCursor(data.nextCursor);
      } catch (error) {
        console.error("Failed to fetch assets:", error);
      }
    },
    [buildQuery, dateFrom, dateTo]
  );

  useEffect(() => {
    setLoading(true);
    fetchAssets().finally(() => setLoading(false));
  }, [fetchAssets]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    await fetchAssets(nextCursor);
    setLoadingMore(false);
  }, [nextCursor, loadingMore, fetchAssets]);

  useEffect(() => {
    const el = observerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && nextCursor && !loadingMore) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [nextCursor, loadingMore, loadMore]);

  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/assets/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      setAssets((prev) => prev.filter((a) => a.id !== id));
      setSelectedAsset(null);
      setDeleteConfirm(null);
    } catch (error) {
      console.error("Failed to delete asset:", error);
    } finally {
      setDeleting(false);
    }
  };

  const handleAnimate = (asset: GalleryAsset) => {
    // Navigate to generate page with image-to-video params
    const params = new URLSearchParams({
      mediaType: "video",
      imageInput: asset.url,
      prompt: asset.prompt,
    });
    router.push(`/generate?${params.toString()}`);
  };

  const handleSaveAsBrew = async () => {
    if (!brewAsset || !brewName.trim()) return;
    setIsSavingBrew(true);
    try {
      const res = await fetch("/api/brews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: brewName.trim(),
          description: brewDescription.trim() || undefined,
          model: brewAsset.model,
          prompt: brewIncludePrompt ? brewAsset.prompt : undefined,
          enhancedPrompt: brewIncludePrompt ? brewAsset.enhancedPrompt : undefined,
          parameters: brewAsset.parameters,
          previewUrl: brewAsset.thumbnailUrl || brewAsset.url,
          imageInput: normalizeImageInputs((brewAsset.parameters as Record<string, unknown> | null)?.imageInput) || undefined,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        console.error("Save brew error:", res.status, text);
        throw new Error("Failed to save");
      }
      toast.success("Brew saved!");
      setBrewAsset(null);
      setBrewName("");
      setBrewDescription("");
    } catch {
      toast.error("Failed to save brew");
    } finally {
      setIsSavingBrew(false);
    }
  };

  const handleSubmitForReview = async (asset: GalleryAsset) => {
    try {
      const res = await fetch(`/api/assets/${asset.id}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit" }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (body.error === "personal_brand_no_review") {
          toast.error("Personal-brand assets can't be submitted for review.");
        } else if (body.error === "invalid_transition") {
          toast.error("Only drafts can be submitted.");
        } else {
          toast.error(`Couldn't submit: ${body.error ?? res.statusText}`);
        }
        return;
      }
      toast.success("Submitted for review");
      const updated: GalleryAsset = { ...asset, status: "in_review" };
      setAssets((prev) => prev.map((a) => (a.id === asset.id ? updated : a)));
      setSelectedAsset(updated);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("opencauldron:review-changed"));
      }
    } catch {
      toast.error("Network error");
    }
  };

  const isAdmin = me.role === "owner" || me.role === "admin";

  /** Brands the caller is `creator+` on (admin override sees every brand). */
  const reassignDestinations = useMemo(() => {
    if (!selectedAsset) return [] as AssetBrand[];
    return allBrands.filter((b) => {
      if (b.isPersonal) return false;
      if (b.id === selectedAsset.brandId) return false;
      if (isAdmin) return true;
      const role = me.brandRoles[b.id];
      return role === "brand_manager" || role === "creator";
    });
  }, [allBrands, isAdmin, me.brandRoles, selectedAsset]);

  /** Server-side is authoritative; this only hides the button when there's no
   *  chance the call would succeed. */
  const canReassignSelected = useMemo(() => {
    if (!selectedAsset) return false;
    if (selectedAsset.status === "approved") return false;
    if (!selectedAsset.brandId) return false;
    if (selectedAsset.userId && me.userId && selectedAsset.userId === me.userId) {
      return true;
    }
    if (isAdmin) return true;
    return me.brandRoles[selectedAsset.brandId] === "brand_manager";
  }, [isAdmin, me.brandRoles, me.userId, selectedAsset]);

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
          approved_immutable_fork_required:
            "Approved assets must be forked, not moved.",
          target_must_be_real_brand: "Personal brands can't be a destination.",
          target_same_as_source: "Asset is already on that brand.",
          cross_workspace_move_forbidden:
            "Can't move assets between workspaces.",
          forbidden: "You don't have permission to move this asset.",
          asset_not_found: "Asset no longer exists.",
          target_brand_not_found: "Destination brand no longer exists.",
        };
        toast.error(map[body.error] ?? `Couldn't move: ${body.error ?? res.statusText}`);
        return;
      }
      const targetBrand = allBrands.find((b) => b.id === reassignTargetBrandId);
      const brandStub: AssetBrand | null = targetBrand
        ? {
            id: targetBrand.id,
            name: targetBrand.name,
            color: targetBrand.color,
            isPersonal: targetBrand.isPersonal,
          }
        : null;
      toast.success(`Moved to ${targetBrand?.name ?? "brand"}.`);
      setAssets((prev) =>
        prev.map((a) =>
          a.id === selectedAsset.id
            ? {
                ...a,
                brandId: reassignTargetBrandId,
                status: "draft",
                brand: brandStub,
                brands: brandStub ? [brandStub] : [],
              }
            : a
        )
      );
      setSelectedAsset((prev) =>
        prev && prev.id === selectedAsset.id
          ? {
              ...prev,
              brandId: reassignTargetBrandId,
              status: "draft",
              brand: brandStub,
              brands: brandStub ? [brandStub] : [],
            }
          : prev
      );
      // /brands/[slug]/gallery locks the brand filter — when we move OUT of
      // that brand, the asset would disappear on next refetch anyway. Drop it
      // now so the grid stays coherent.
      if (lockedBrandId && reassignTargetBrandId !== lockedBrandId) {
        setAssets((prev) => prev.filter((a) => a.id !== selectedAsset.id));
        setSelectedAsset(null);
      }
      setReassignOpen(false);
      setReassignTargetBrandId("");
    } catch {
      toast.error("Network error");
    } finally {
      setReassigning(false);
    }
  }

  const handleFork = async (asset: GalleryAsset) => {
    try {
      const res = await fetch(`/api/assets/${asset.id}/fork`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (body.error === "fork_requires_approved") {
          toast.error("Only approved assets can be forked.");
        } else {
          toast.error(`Couldn't fork: ${body.error ?? res.statusText}`);
        }
        return;
      }
      const data = (await res.json()) as {
        asset: { id: string; brandId: string | null };
      };
      toast.success("Forked — opening editor");
      const params = new URLSearchParams({
        prompt: asset.prompt,
        model: asset.model,
        mediaType: asset.mediaType,
        forkOf: data.asset.id,
      });
      if (data.asset.brandId) params.set("brandId", data.asset.brandId);
      router.push(`/generate?${params.toString()}`);
    } catch {
      toast.error("Network error");
    }
  };

  const hasFilters =
    !!modelFilter ||
    !!mediaTypeFilter ||
    !!statusFilter ||
    (!!brandFilter && !lockedBrandId) ||
    !!searchQuery ||
    !!dateFrom ||
    !!dateTo;
  const clearFilters = () => {
    setModelFilter("");
    setMediaTypeFilter("");
    setStatusFilter("");
    if (!lockedBrandId) setBrandFilter("");
    setSearchQuery("");
    setDateFrom("");
    setDateTo("");
  };

  const activeBrandOption = useMemo(
    () => allBrands.find((b) => b.id === brandFilter) ?? null,
    [allBrands, brandFilter]
  );

  const handleUploaded = useCallback(
    (uploaded: UploadedAsset) => {
      const brand = allBrands.find((b) => b.id === uploaded.brandId) ?? null;
      const fresh: GalleryAsset = {
        id: uploaded.id,
        userId: "",
        brandId: uploaded.brandId,
        status: uploaded.status,
        parentAssetId: null,
        mediaType: uploaded.mediaType,
        model: "upload",
        provider: "upload",
        prompt: "",
        enhancedPrompt: null,
        parameters: null,
        url: uploaded.url,
        thumbnailUrl: uploaded.thumbnailUrl,
        width: uploaded.width,
        height: uploaded.height,
        fileSize: uploaded.fileSize,
        costEstimate: 0,
        duration: null,
        hasAudio: null,
        createdAt: uploaded.createdAt,
        brand: brand
          ? { id: brand.id, name: brand.name, color: brand.color, isPersonal: brand.isPersonal }
          : null,
        brands: brand ? [brand] : [],
        tags: [],
        user: { name: null, email: null, image: null },
        // The WebP encode runs on the server during the upload pipeline; the
        // upload response shape doesn't carry it back yet, so this fresh row
        // shows the original until the next refetch hydrates the variant.
        webpUrl: null,
        webpFileSize: null,
        webpStatus: null,
        originalMimeType: null,
        originalFileSize: uploaded.fileSize,
      };
      setAssets((prev) => [fresh, ...prev]);
    },
    [allBrands]
  );

  function openUpload() {
    if (!uploadBrandId) {
      setUploadBrandId(brandFilter || allBrands[0]?.id || "");
    }
    setUploadOpen(true);
  }

  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-36">
          <Select
            value={mediaTypeFilter}
            onValueChange={(v) => setMediaTypeFilter(v ?? "")}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All Media" />
            </SelectTrigger>
            <SelectContent>
              {MEDIA_TYPE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-40">
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter((v as AssetStatus | "") ?? "")}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All Statuses</SelectItem>
              {ASSET_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {allBrands.length > 0 && !lockedBrandId && (
          <div className="w-44">
            <Select
              value={brandFilter}
              onValueChange={(v) => setBrandFilter(v ?? "")}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="All Brands" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All Brands</SelectItem>
                {allBrands.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    <span className="flex items-center gap-2">
                      <BrandMark brand={b} size="xs" />
                      {b.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="w-44">
          <Select
            value={modelFilter}
            onValueChange={(v) => setModelFilter(v ?? "")}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All Models" />
            </SelectTrigger>
            <SelectContent>
              {MODEL_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search prompts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Calendar className="size-4 text-muted-foreground" />
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-36"
            />
          </div>
          <span className="text-muted-foreground text-sm">to</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-36"
          />
        </div>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="size-3.5 mr-1" />
            Clear
          </Button>
        )}

        <div className="ml-auto">
          <Button
            variant="default"
            size="sm"
            onClick={openUpload}
            disabled={allBrands.length === 0}
          >
            <Upload className="size-3.5 mr-1" />
            Upload
          </Button>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="aspect-square w-full rounded-lg" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      )}

      {/* Empty State (T114) — distinguishes "filtered down to nothing" from
          "you don't have access to anything in this brand". */}
      {!loading && assets.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-20 text-center">
          <ImageIcon className="size-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium">
            {brandFilter && allBrands.length > 0 && !activeBrandOption
              ? "No access to this brand"
              : hasFilters
              ? "No assets match these filters"
              : "No assets yet"}
          </h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            {brandFilter && allBrands.length > 0 && !activeBrandOption
              ? "Ask a brand manager to add you, then refresh."
              : brandFilter && activeBrandOption
              ? `Nothing in ${activeBrandOption.name} matches the current filters yet.`
              : hasFilters
              ? "Try adjusting your filters or search query."
              : "Generate some images or videos to see them here."}
          </p>
          {hasFilters && (
            <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>
              Clear Filters
            </Button>
          )}
        </div>
      )}

      {/* Grid */}
      {!loading && assets.length > 0 && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {assets.map((asset) => (
            <GalleryCard
              key={asset.id}
              asset={asset}
              onClick={() => setSelectedAsset(asset)}
            />
          ))}
        </div>
      )}

      {/* Infinite scroll sentinel */}
      {nextCursor && (
        <div ref={observerRef} className="flex justify-center py-6">
          {loadingMore ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading more...
            </div>
          ) : (
            <Button variant="outline" onClick={loadMore}>
              Load More
            </Button>
          )}
        </div>
      )}

      {/* Lightbox Dialog */}
      <Dialog
        open={!!selectedAsset}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedAsset(null);
            setReassignOpen(false);
            setReassignTargetBrandId("");
          }
        }}
      >
        {selectedAsset && (
          <DialogContent className="sm:max-w-6xl h-[92vh] max-h-[920px] flex flex-col gap-0 p-0 overflow-hidden">
            <DialogHeader className="px-6 py-4 border-b shrink-0 pr-12">
              <DialogTitle>Asset Details</DialogTitle>
              <DialogDescription>
                Generated with {getModelLabel(selectedAsset.model)}
              </DialogDescription>
            </DialogHeader>

            <div className="grid flex-1 min-h-0 md:grid-cols-[minmax(0,1fr)_340px]">
              {/* Media — fills available space; image scales to its own aspect
                  ratio via object-contain. No fixed min-height, so when the
                  image is short-and-wide we don't get dark padding above/below. */}
              <div className="relative flex items-center justify-center overflow-hidden bg-muted/40">
                {selectedAsset.mediaType === "video" ? (
                  <video
                    src={selectedAsset.url}
                    controls
                    autoPlay
                    muted
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  // Prefer the WebP rendition when ready (FR-008 / US2). The
                  // fallback to the original is silent — users aren't told the
                  // WebP failed/wasn't ready, they just see the same image.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={
                      selectedAsset.webpStatus === "ready" && selectedAsset.webpUrl
                        ? selectedAsset.webpUrl
                        : selectedAsset.url
                    }
                    alt={selectedAsset.prompt}
                    className="max-h-full max-w-full object-contain"
                  />
                )}
              </div>

              {/* Metadata + Thread Panel — Tabs strip flips the right column
                  between asset metadata and the conversation. Asset stays
                  fully visible on the left no matter which tab is active.
                  Mirrors the library detail panel pattern. */}
              <Tabs
                defaultValue="info"
                className="flex min-h-0 flex-col gap-0 border-t md:border-t-0 md:border-l"
              >
                <div className="border-b border-border bg-background px-5 py-2">
                  <TabsList variant="line" className="w-full justify-start gap-3">
                    <TabsTrigger value="info">Info</TabsTrigger>
                    <TabsTrigger value="thread">
                      <MessageSquareText aria-hidden />
                      Thread
                    </TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent
                  value="info"
                  className="flex-1 space-y-4 overflow-y-auto p-6 data-active:flex data-active:flex-col"
                >
                {/* Creator — identity at the top, with avatar */}
                <div className="flex items-center gap-3">
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={selectedAsset.user.image ?? undefined} />
                    <AvatarFallback className="text-xs">
                      {selectedAsset.user.name?.charAt(0)?.toUpperCase() ?? "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {selectedAsset.user.name ?? selectedAsset.user.email ?? "Unknown"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(selectedAsset.createdAt).toLocaleDateString(
                        undefined,
                        {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        }
                      )}
                    </p>
                  </div>
                </div>

                {/* Brand — ownership context */}
                {selectedAsset.brand && (
                  <div>
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
                      style={{
                        backgroundColor: `${selectedAsset.brand.color}20`,
                        borderColor: `${selectedAsset.brand.color}60`,
                        color: selectedAsset.brand.color,
                      }}
                    >
                      <BrandMark brand={selectedAsset.brand} size="xs" />
                      {selectedAsset.brand.name}
                      {selectedAsset.brand.isPersonal ? " (Personal)" : ""}
                    </span>
                  </div>
                )}

                {/* Status + Model + Provider — state badges */}
                <div className="flex flex-wrap items-center gap-2">
                  {selectedAsset.status && (
                    <StatusBadge status={selectedAsset.status} size="md" />
                  )}
                  <Badge variant="secondary">
                    {getModelLabel(selectedAsset.model)}
                  </Badge>
                  <Badge variant="outline">{PROVIDER_LABELS[selectedAsset.provider] ?? selectedAsset.provider}</Badge>
                  {selectedAsset.mediaType === "video" && (
                    <Badge variant="outline" className="gap-1">
                      <Video className="size-3" />
                      Video
                    </Badge>
                  )}
                </div>

                {/* Video-only metadata sits with the badges */}
                {selectedAsset.mediaType === "video" && (selectedAsset.duration || selectedAsset.hasAudio) && (
                  <div className="flex gap-3">
                    {selectedAsset.duration && (
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Clock className="size-3.5" />
                        {selectedAsset.duration}s
                      </div>
                    )}
                    {selectedAsset.hasAudio && (
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Volume2 className="size-3.5" />
                        Audio
                      </div>
                    )}
                  </div>
                )}

                {/* Prompt — main content */}
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-1">
                    Prompt
                  </h4>
                  <p className="text-sm leading-relaxed">
                    {selectedAsset.prompt}
                  </p>
                </div>

                {selectedAsset.enhancedPrompt && (
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-1">
                      Enhanced Prompt
                    </h4>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {selectedAsset.enhancedPrompt}
                    </p>
                  </div>
                )}

                {normalizeImageInputs(selectedAsset.parameters?.imageInput).length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-1">
                      Reference {normalizeImageInputs(selectedAsset.parameters?.imageInput).length > 1 ? "Images" : "Image"}
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {normalizeImageInputs(selectedAsset.parameters?.imageInput).map((url, i) => (
                        <a
                          key={i}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt={`Reference ${i + 1}`}
                            className="h-20 w-20 rounded-md object-cover ring-1 ring-border/50 hover:ring-primary transition-all cursor-pointer"
                          />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {(() => {
                  const params = selectedAsset.parameters;
                  if (!params) return null;
                  const entries = Object.entries(params).filter(
                    ([key, v]) => v != null && v !== "" && key !== "imageInput" && key !== "loras"
                  );
                  return entries.length > 0 ? (
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-1">
                        Parameters
                      </h4>
                      <div className="flex flex-wrap gap-1">
                        {entries.map(([key, value]) => (
                          <Badge key={key} variant="outline" className="text-xs">
                            {key}: {String(value)}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ) : null;
                })()}

                {(selectedAsset.width || selectedAsset.height) && (
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-1">
                      Dimensions
                    </h4>
                    <p className="text-sm">
                      {selectedAsset.width} x {selectedAsset.height}px
                      {selectedAsset.fileSize && (
                        <span className="text-muted-foreground ml-2">
                          ({formatFileSize(selectedAsset.fileSize)})
                        </span>
                      )}
                    </p>
                  </div>
                )}

                {selectedAsset.tags.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-1">
                      Tags
                    </h4>
                    <div className="flex flex-wrap gap-1">
                      {selectedAsset.tags.map((tag) => (
                        <Badge key={tag} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                </TabsContent>

                <TabsContent
                  value="thread"
                  className="flex min-h-0 flex-1 flex-col data-[hidden]:hidden"
                >
                  <ThreadPanel
                    // Re-mount on asset change so the SSE stream resets cleanly.
                    key={selectedAsset.id}
                    assetId={selectedAsset.id}
                    viewer={viewer}
                  />
                </TabsContent>
              </Tabs>
            </div>

            {reassignOpen && (
              <div className="border-t bg-muted/40 p-4 space-y-3 shrink-0">
                <div>
                  <h4 className="text-sm font-medium">Move to brand</h4>
                  <p className="text-xs text-muted-foreground">
                    The asset moves in place — no duplicate, same id.
                  </p>
                </div>
                <Select
                  value={reassignTargetBrandId}
                  onValueChange={(v) => setReassignTargetBrandId(v ?? "")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Pick a destination brand…" />
                  </SelectTrigger>
                  <SelectContent>
                    {reassignDestinations.length === 0 ? (
                      <SelectItem value="__none" disabled>
                        No eligible brands
                      </SelectItem>
                    ) : (
                      reassignDestinations.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          <span className="flex items-center gap-2">
                            <BrandMark brand={b} size="xs" />
                            {b.name}
                          </span>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {selectedAsset.status === "in_review" && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Moving this asset will reset its status to draft and
                    require resubmission.
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setReassignOpen(false);
                      setReassignTargetBrandId("");
                    }}
                    disabled={reassigning}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleReassign}
                    disabled={!reassignTargetBrandId || reassigning}
                  >
                    {reassigning ? (
                      <Loader2 className="size-4 animate-spin mr-1" />
                    ) : null}
                    Move
                  </Button>
                </div>
              </div>
            )}

            <DialogFooter className="m-0 shrink-0 flex-wrap">
              {/* Submit for review (T094) — drafts only */}
              {selectedAsset.status === "draft" && (
                <Button
                  variant="default"
                  onClick={() => handleSubmitForReview(selectedAsset)}
                >
                  <Send className="size-4 mr-1.5" />
                  Submit for review
                </Button>
              )}
              {/* Edit / Fork (T095) — approved only */}
              {selectedAsset.status === "approved" && (
                <Button
                  variant="default"
                  onClick={() => handleFork(selectedAsset)}
                >
                  <GitFork className="size-4 mr-1.5" />
                  Edit / Fork
                </Button>
              )}
              {/* Move to brand… — creator+, brand_manager on source, or
                  workspace admin. Hidden for approved (fork-required) and
                  while the inline picker is already open. */}
              {canReassignSelected && !reassignOpen && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setReassignTargetBrandId(reassignDestinations[0]?.id ?? "");
                    setReassignOpen(true);
                  }}
                >
                  <ArrowRightLeft className="size-4 mr-1.5" />
                  Move to brand…
                </Button>
              )}
              {/* Save as Brew */}
              <Button
                variant="outline"
                onClick={() => {
                  setBrewName("");
                  setBrewDescription("");
                  setBrewIncludePrompt(true);
                  setBrewAsset(selectedAsset);
                }}
              >
                <FlaskConical className="size-4 mr-1.5" />
                Brew
              </Button>
              {/* Use as reference / Animate — image assets only */}
              {selectedAsset.mediaType === "image" && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelectedAsset(null);
                      router.push(`/generate?imageInput=${encodeURIComponent(selectedAsset.url)}`);
                    }}
                  >
                    <ImagePlus className="size-4 mr-1.5" />
                    Reference
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelectedAsset(null);
                      handleAnimate(selectedAsset);
                    }}
                  >
                    <Wand2 className="size-4 mr-1.5" />
                    Animate
                  </Button>
                </>
              )}
              {/* Dual-format download (FR-009). For images with a ready WebP
                  this renders as a desktop split button + mobile menu; for
                  videos and failed/never-encoded assets it collapses to a
                  single original-only button — see AssetDownloadButton. */}
              <AssetDownloadButton
                asset={{
                  id: selectedAsset.id,
                  webpUrl: selectedAsset.webpUrl,
                  webpFileSize: selectedAsset.webpFileSize,
                  webpStatus: selectedAsset.webpStatus,
                  originalFileSize: selectedAsset.originalFileSize ?? selectedAsset.fileSize ?? 0,
                  originalMimeType: selectedAsset.originalMimeType,
                  kind: selectedAsset.mediaType === "video" ? "video" : "image",
                }}
                source="gallery"
                variant="outline"
              />
              <Button
                variant="destructive"
                onClick={() => setDeleteConfirm(selectedAsset.id)}
              >
                <Trash2 className="size-4 mr-1.5" />
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deleteConfirm}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Asset</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this asset? This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteConfirm(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <Loader2 className="size-4 mr-1.5 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload Dialog (T122) — brand picker + dropzone */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Upload to gallery
            </DialogTitle>
            <DialogDescription>
              Drop images or short videos here. Up to 50MB per file. New
              uploads land as drafts on the brand you pick.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="upload-brand">Brand</Label>
              <Select
                value={uploadBrandId}
                onValueChange={(v) => setUploadBrandId(v ?? "")}
              >
                <SelectTrigger id="upload-brand" className="w-full">
                  <SelectValue placeholder="Select a brand…" />
                </SelectTrigger>
                <SelectContent>
                  {allBrands.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      <span className="flex items-center gap-2">
                        <BrandMark brand={b} size="xs" />
                        {b.name}
                        {b.isPersonal && (
                          <span className="ml-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                            personal
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <UploadDropzone
              brandId={uploadBrandId || null}
              onUploaded={handleUploaded}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Save as Brew Dialog */}
      <Dialog open={!!brewAsset} onOpenChange={(open) => { if (!open) setBrewAsset(null); }}>
        {brewAsset ? (
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FlaskConical className="h-5 w-5" />
                Save as Brew
              </DialogTitle>
              <DialogDescription>
                Save this generation&apos;s recipe for quick reuse.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="gallery-brew-name">Name</Label>
                <Input
                  id="gallery-brew-name"
                  value={brewName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBrewName(e.target.value)}
                  placeholder="e.g. Anime Portrait Setup"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gallery-brew-desc">Description (optional)</Label>
                <Textarea
                  id="gallery-brew-desc"
                  value={brewDescription}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBrewDescription(e.target.value)}
                  placeholder="What's this brew for?"
                  rows={2}
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="gallery-brew-prompt"
                  checked={brewIncludePrompt}
                  onCheckedChange={setBrewIncludePrompt}
                />
                <Label htmlFor="gallery-brew-prompt" className="text-sm cursor-pointer">
                  Include prompt text
                </Label>
              </div>
              <div className="rounded-lg border border-border/50 bg-secondary/20 p-3 space-y-1.5 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-foreground">{getModelLabel(brewAsset.model)}</span>
                  <Badge variant="outline" className="text-[9px]">{brewAsset.provider}</Badge>
                </div>
                {brewIncludePrompt && brewAsset.prompt ? (
                  <p className="line-clamp-2 italic">&quot;{brewAsset.prompt}&quot;</p>
                ) : (
                  <p className="opacity-60">Config only — no prompt</p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setBrewAsset(null)}>Cancel</Button>
              <Button onClick={handleSaveAsBrew} disabled={!brewName.trim() || isSavingBrew}>
                {isSavingBrew ? <Loader2 className="size-4 animate-spin mr-1" /> : null}
                Save Brew
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

// -------------------------------------------------------------------
// Gallery Card
// -------------------------------------------------------------------

function GalleryCard({
  asset,
  onClick,
}: {
  asset: GalleryAsset;
  onClick: () => void;
}) {
  const isVideo = asset.mediaType === "video";

  return (
    <button
      onClick={onClick}
      className="group relative overflow-hidden rounded-lg bg-muted text-left cursor-pointer transition-all hover:ring-2 hover:ring-ring/50 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="aspect-square relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset.thumbnailUrl}
          alt={asset.prompt}
          className="h-full w-full object-cover"
          loading="lazy"
        />

        {/* Brand tag — top-left, single brand from FK (FR-009). */}
        {asset.brand && (
          <div className="absolute top-2 left-2 z-10">
            <span
              className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold backdrop-blur-sm border"
              style={{
                backgroundColor: `${asset.brand.color}40`,
                borderColor: `${asset.brand.color}60`,
                color: "white",
              }}
            >
              {asset.brand.name}
            </span>
          </div>
        )}

        {/* Status badge — top-right (FR-010). Hidden for legacy assets that
            haven't been backfilled yet (status === null). */}
        {asset.status && (
          <div className="absolute top-2 right-2 z-10">
            <StatusBadge status={asset.status} />
          </div>
        )}

        {/* Video overlay indicators */}
        {isVideo && (
          <>
            {/* Play icon */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm transition-transform group-hover:scale-110">
                <Play className="size-5 text-white fill-white ml-0.5" />
              </div>
            </div>

            {/* Duration badge */}
            {asset.duration && (
              <div className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white tabular-nums backdrop-blur-sm">
                {asset.duration}s
              </div>
            )}

            {/* Audio indicator — moved to bottom-left so the status badge owns
                the top-right slot. */}
            {asset.hasAudio && (
              <div className="absolute bottom-2 left-2">
                <Volume2 className="size-3.5 text-white drop-shadow-md" />
              </div>
            )}
          </>
        )}

        {/* Hover Overlay */}
        <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/70 via-black/20 to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100">
          <p className="line-clamp-2 text-xs text-white/90 leading-relaxed">
            {asset.prompt}
          </p>
          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-1 flex-wrap min-w-0">
              <Badge
                variant="secondary"
                className="text-[10px] bg-white/20 text-white border-0"
              >
                {getModelLabel(asset.model)}
              </Badge>
              {asset.brand && (
                <span
                  className="rounded-full px-1.5 py-0.5 text-[9px] font-medium border"
                  style={{
                    backgroundColor: `${asset.brand.color}30`,
                    borderColor: `${asset.brand.color}50`,
                    color: asset.brand.color,
                  }}
                >
                  {asset.brand.name}
                </span>
              )}
            </div>
            <Avatar className="h-5 w-5 shrink-0 ml-2 ring-1 ring-white/30">
              <AvatarImage src={asset.user.image ?? undefined} />
              <AvatarFallback className="text-[8px] bg-white/20 text-white">
                {asset.user.name?.charAt(0)?.toUpperCase() ?? "?"}
              </AvatarFallback>
            </Avatar>
          </div>
        </div>
      </div>
    </button>
  );
}

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function getModelLabel(model: string): string {
  const labels: Record<string, string> = {
    "imagen-4": "Imagen 4",
    "imagen-flash": "Imagen Flash",
    "imagen-flash-lite": "Imagen Lite",
    "grok-imagine": "Grok Imagine",
    "grok-imagine-pro": "Grok Pro",
    "flux-1.1-pro": "Flux Pro",
    "flux-dev": "Flux Dev",
    "ideogram-3": "Ideogram 3",
    "recraft-v3": "Recraft V3",
    "recraft-20b": "Recraft 20B",
    "veo-3": "Veo 3",
    "runway-gen4-turbo": "Gen-4 Turbo",
    "kling-2.1": "Kling 2.1",
    "hailuo-2.3": "Hailuo 2.3",
    "ray-2": "Ray 2",
  };
  return labels[model] ?? model;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
