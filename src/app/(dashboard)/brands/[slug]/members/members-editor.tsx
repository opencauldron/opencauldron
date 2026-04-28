"use client";

/**
 * Members editor — invite + role + remove. Optimistic UI on every mutation,
 * with rollback when the API rejects (e.g. 409 last_brand_manager). The
 * server is authoritative for permissions (NFR-004); this component only
 * hides controls that the API would also refuse.
 */

import { useState } from "react";
import { Info, Loader2, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type BrandRole = "brand_manager" | "creator" | "viewer";

export interface MemberRow {
  userId: string;
  role: BrandRole;
  email: string | null;
  name: string | null;
  image: string | null;
}

interface Props {
  brand: { id: string; name: string; color: string };
  currentUserId: string;
  initialMembers: MemberRow[];
}

const ROLE_LABELS: Record<BrandRole, string> = {
  brand_manager: "Brand manager",
  creator: "Creator",
  viewer: "Viewer",
};

const ROLE_DESCRIPTIONS: Record<BrandRole, string> = {
  brand_manager:
    "Invite/remove members, edit brand kit, approve assets.",
  creator:
    "Generate, save to gallery, propose assets for review.",
  viewer: "Read-only access to this brand.",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function initialsOf(member: MemberRow): string {
  const source = member.name ?? member.email ?? "?";
  const parts = source.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export function MembersEditor({ brand, currentUserId, initialMembers }: Props) {
  const [members, setMembers] = useState<MemberRow[]>(() =>
    sortMembers(initialMembers, currentUserId)
  );
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<BrandRole>("creator");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [pendingRoleUserIds, setPendingRoleUserIds] = useState<Set<string>>(
    () => new Set()
  );
  const [removeTarget, setRemoveTarget] = useState<MemberRow | null>(null);
  const [removing, setRemoving] = useState(false);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!email) {
      setInviteError("Enter an email address.");
      return;
    }
    if (!EMAIL_RE.test(email)) {
      setInviteError("Enter a valid email address.");
      return;
    }
    setInviteError(null);
    setInviting(true);
    try {
      const res = await fetch(`/api/brands/${brand.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: inviteRole }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 403) {
          toast.error("You don't have permission to invite to this brand.");
        } else if (res.status === 400) {
          setInviteError(body.error ?? "Invalid input.");
        } else {
          toast.error(body.error ?? "Failed to invite.");
        }
        return;
      }
      // Optimistic prepend with placeholder fields filled by a follow-up GET
      // so the row reflects the canonical shape (name/image) when known.
      const newRow: MemberRow = {
        userId: body.userId,
        role: body.role,
        email,
        name: null,
        image: null,
      };
      setMembers((prev) => {
        const without = prev.filter((m) => m.userId !== newRow.userId);
        return sortMembers([newRow, ...without], currentUserId);
      });
      setInviteEmail("");
      toast.success(`Invited ${email}`);

      // Refresh the list quietly so user metadata (name/image) populates if
      // the invitee already had an account.
      void refreshMembers(brand.id, currentUserId).then((rows) => {
        if (rows) setMembers(rows);
      });
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setInviting(false);
    }
  }

  async function handleRoleChange(member: MemberRow, nextRole: BrandRole) {
    if (nextRole === member.role) return;
    const previousRole = member.role;

    // Optimistic apply.
    setMembers((prev) =>
      sortMembers(
        prev.map((m) =>
          m.userId === member.userId ? { ...m, role: nextRole } : m
        ),
        currentUserId
      )
    );
    setPendingRoleUserIds((prev) => {
      const next = new Set(prev);
      next.add(member.userId);
      return next;
    });

    try {
      const res = await fetch(`/api/brands/${brand.id}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: member.userId, role: nextRole }),
      });
      if (!res.ok) {
        // Rollback.
        setMembers((prev) =>
          sortMembers(
            prev.map((m) =>
              m.userId === member.userId ? { ...m, role: previousRole } : m
            ),
            currentUserId
          )
        );
        const body = await res.json().catch(() => ({}));
        if (res.status === 409 && body.error === "last_brand_manager") {
          toast.error(
            "Cannot demote the last brand manager. Promote another member first."
          );
        } else if (res.status === 403) {
          toast.error("You don't have permission to change this role.");
        } else {
          toast.error(body.error ?? "Failed to update role.");
        }
        return;
      }
      toast.success(`Role updated to ${ROLE_LABELS[nextRole]}.`);
    } catch {
      // Rollback on network error.
      setMembers((prev) =>
        sortMembers(
          prev.map((m) =>
            m.userId === member.userId ? { ...m, role: previousRole } : m
          ),
          currentUserId
        )
      );
      toast.error("Network error. Please try again.");
    } finally {
      setPendingRoleUserIds((prev) => {
        const next = new Set(prev);
        next.delete(member.userId);
        return next;
      });
    }
  }

  async function confirmRemove() {
    if (!removeTarget) return;
    const target = removeTarget;
    setRemoving(true);
    // Optimistic remove.
    const previous = members;
    setMembers((prev) => prev.filter((m) => m.userId !== target.userId));
    try {
      const res = await fetch(`/api/brands/${brand.id}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: target.userId }),
      });
      if (!res.ok) {
        setMembers(previous);
        const body = await res.json().catch(() => ({}));
        if (res.status === 409 && body.error === "last_brand_manager") {
          toast.error("Cannot remove the last brand manager.");
        } else if (res.status === 403) {
          toast.error("You don't have permission to remove this member.");
        } else {
          toast.error(body.error ?? "Failed to remove member.");
        }
        return;
      }
      toast.success(
        `Removed ${target.name ?? target.email ?? "member"} from ${brand.name}.`
      );
      setRemoveTarget(null);
    } catch {
      setMembers(previous);
      toast.error("Network error. Please try again.");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Members</h2>
        <p className="text-sm text-muted-foreground">
          Invite teammates to this brand and assign their permissions.
        </p>
      </header>

      {/* Invite */}
      <section className="rounded-lg border border-border/60 bg-card p-5">
        <form onSubmit={handleInvite} className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="invite-email" className="text-sm font-medium">
              Invite by email
            </Label>
            <RoleInfoTooltip />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <div className="flex-1">
              <Input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => {
                  setInviteEmail(e.target.value);
                  if (inviteError) setInviteError(null);
                }}
                placeholder="teammate@studio.com"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                disabled={inviting}
                aria-invalid={inviteError ? true : undefined}
              />
              {inviteError && (
                <p className="mt-1 text-xs text-destructive">{inviteError}</p>
              )}
            </div>
            <Select
              value={inviteRole}
              onValueChange={(v) => {
                if (v) setInviteRole(v as BrandRole);
              }}
            >
              <SelectTrigger className="sm:w-44">
                <SelectValue>
                  {(v) => (v ? ROLE_LABELS[v as BrandRole] : null)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ROLE_LABELS) as BrandRole[]).map((role) => (
                  <SelectItem key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" disabled={inviting} className="sm:self-start">
              {inviting ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="mr-1.5 h-4 w-4" />
              )}
              Invite
            </Button>
          </div>
        </form>
      </section>

      {/* List */}
      {members.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border/60 bg-card/40 px-6 py-12 text-center text-sm text-muted-foreground">
          <UserPlus className="h-5 w-5" />
          <p>No members yet. Invite teammates above to get started.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border/60 bg-card">
          <ul className="divide-y divide-border/60">
            {members.map((member) => {
              const isSelf = member.userId === currentUserId;
              const rolePending = pendingRoleUserIds.has(member.userId);
              const displayName = member.name ?? member.email ?? "Unknown";
              return (
                <li
                  key={member.userId}
                  className="group/member flex items-center gap-3 border-l-2 px-4 py-3 transition-colors duration-200 hover:bg-accent/30"
                  style={{ borderLeftColor: brand.color }}
                >
                  <Avatar size="default">
                    {member.image ? (
                      <AvatarImage src={member.image} alt={displayName} />
                    ) : null}
                    <AvatarFallback>{initialsOf(member)}</AvatarFallback>
                  </Avatar>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-foreground">
                        {displayName}
                        {isSelf && (
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                            (you)
                          </span>
                        )}
                      </p>
                      {member.role === "brand_manager" && !isSelf && (
                        <Badge
                          variant="secondary"
                          className="border-primary/30 bg-primary/10 text-primary"
                        >
                          Brand manager
                        </Badge>
                      )}
                    </div>
                    {member.email && member.name && (
                      <p className="truncate text-xs text-muted-foreground">
                        {member.email}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {isSelf ? (
                      <span className="rounded-md border border-border/60 bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
                        {ROLE_LABELS[member.role]}
                      </span>
                    ) : (
                      <Select
                        value={member.role}
                        onValueChange={(v) => {
                          if (v) handleRoleChange(member, v as BrandRole);
                        }}
                        disabled={rolePending}
                      >
                        <SelectTrigger size="sm" className="w-36">
                          <SelectValue>
                            {(v) => (v ? ROLE_LABELS[v as BrandRole] : null)}
                          </SelectValue>
                          {rolePending && (
                            <Loader2 className="ml-1 h-3 w-3 animate-spin text-muted-foreground" />
                          )}
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(ROLE_LABELS) as BrandRole[]).map(
                            (role) => (
                              <SelectItem key={role} value={role}>
                                {ROLE_LABELS[role]}
                              </SelectItem>
                            )
                          )}
                        </SelectContent>
                      </Select>
                    )}

                    {!isSelf && (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setRemoveTarget(member)}
                              aria-label={`Remove ${displayName}`}
                              className="text-muted-foreground hover:text-destructive"
                            />
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </TooltipTrigger>
                        <TooltipContent>Remove from brand</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Dialog
        open={removeTarget !== null}
        onOpenChange={(next) => {
          if (!next) setRemoveTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove member</DialogTitle>
            <DialogDescription>
              Remove{" "}
              <span className="text-foreground">
                {removeTarget?.name ?? removeTarget?.email ?? "this member"}
              </span>{" "}
              from {brand.name}? They&apos;ll lose access to this brand.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              variant="destructive"
              onClick={confirmRemove}
              disabled={removing}
            >
              {removing && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RoleInfoTooltip() {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Role descriptions"
          />
        }
      >
        <Info className="h-3.5 w-3.5" />
        Roles
      </TooltipTrigger>
      <TooltipContent className="max-w-xs whitespace-normal">
        <div className="space-y-1.5 py-0.5 text-left">
          {(Object.keys(ROLE_LABELS) as BrandRole[]).map((role) => (
            <div key={role}>
              <span className="font-medium">{ROLE_LABELS[role]}:</span>{" "}
              <span className="opacity-80">{ROLE_DESCRIPTIONS[role]}</span>
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

// --- helpers ---------------------------------------------------------------

const ROLE_RANK: Record<BrandRole, number> = {
  brand_manager: 0,
  creator: 1,
  viewer: 2,
};

function sortMembers(rows: MemberRow[], currentUserId: string): MemberRow[] {
  return [...rows].sort((a, b) => {
    if (a.userId === currentUserId && b.userId !== currentUserId) return -1;
    if (b.userId === currentUserId && a.userId !== currentUserId) return 1;
    const r = ROLE_RANK[a.role] - ROLE_RANK[b.role];
    if (r !== 0) return r;
    const an = (a.name ?? a.email ?? "").toLowerCase();
    const bn = (b.name ?? b.email ?? "").toLowerCase();
    return an.localeCompare(bn);
  });
}

async function refreshMembers(
  brandId: string,
  currentUserId: string
): Promise<MemberRow[] | null> {
  try {
    const res = await fetch(`/api/brands/${brandId}/members`);
    if (!res.ok) return null;
    const rows = (await res.json()) as MemberRow[];
    return sortMembers(rows, currentUserId);
  } catch {
    return null;
  }
}
