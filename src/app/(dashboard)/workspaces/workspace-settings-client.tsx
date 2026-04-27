"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";

interface Member {
  userId: string;
  role: "owner" | "admin" | "member";
  canGenerateVideo: boolean;
  email: string;
  name: string | null;
  image: string | null;
}

interface Props {
  workspace: { id: string; name: string; slug: string };
  role: "owner" | "admin" | "member";
}

export function WorkspaceSettingsClient({ workspace, role }: Props) {
  const [name, setName] = useState(workspace.name);
  const [renaming, setRenaming] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"owner" | "admin" | "member">("member");
  const [inviting, setInviting] = useState(false);

  const canManage = role === "owner" || role === "admin";

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/workspaces/${workspace.id}/members`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as Member[];
        if (active) setMembers(json);
      } catch (err) {
        if (active) toast.error("Failed to load members.");
      } finally {
        if (active) setLoadingMembers(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [workspace.id]);

  async function rename() {
    setRenaming(true);
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Workspace renamed.");
    } catch {
      toast.error("Rename failed.");
    } finally {
      setRenaming(false);
    }
  }

  async function invite() {
    setInviting(true);
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      toast.success(`Invited ${inviteEmail}.`);
      setInviteEmail("");
      // Refresh members list.
      const refreshed = await fetch(`/api/workspaces/${workspace.id}/members`);
      if (refreshed.ok) setMembers(await refreshed.json());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invite failed.");
    } finally {
      setInviting(false);
    }
  }

  async function patchMember(userId: string, patch: Partial<Member>) {
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}/members`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, ...patch }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setMembers((prev) =>
        prev.map((m) => (m.userId === userId ? { ...m, ...patch } as Member : m))
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed.");
    }
  }

  return (
    <div className="space-y-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Workspace</h1>
        <p className="text-sm text-muted-foreground">
          Manage tenant-level settings, billing, and member access.
        </p>
      </header>

      <section className="space-y-4">
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-foreground">General</h2>
          <p className="text-sm text-muted-foreground">
            Slug <code className="rounded bg-muted px-1 py-0.5 text-xs">{workspace.slug}</code>
          </p>
        </div>
        <div className="flex items-end gap-3 max-w-md">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="ws-name">Name</Label>
            <Input
              id="ws-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canManage}
            />
          </div>
          {canManage && (
            <Button onClick={rename} disabled={renaming || name === workspace.name}>
              {renaming ? <Loader2 className="size-4 animate-spin" /> : "Save"}
            </Button>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-foreground">Members</h2>
          {canManage && (
            <span className="text-xs text-muted-foreground">
              Owners can grant any role; admins cannot mint new owners.
            </span>
          )}
        </div>

        {canManage && (
          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border/60 bg-card p-4">
            <div className="flex-1 min-w-[16rem] space-y-1.5">
              <Label htmlFor="invite-email">Invite by email</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="teammate@agency.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-role">Role</Label>
              <select
                id="invite-role"
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as typeof inviteRole)}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                {role === "owner" && <option value="owner">Owner</option>}
              </select>
            </div>
            <Button onClick={invite} disabled={!inviteEmail || inviting}>
              {inviting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <>
                  <UserPlus className="size-4" /> Invite
                </>
              )}
            </Button>
          </div>
        )}

        {loadingMembers ? (
          <p className="text-sm text-muted-foreground">Loading members…</p>
        ) : (
          <ul className="divide-y divide-border/60 rounded-lg border border-border/60 bg-card">
            {members.map((m) => (
              <li
                key={m.userId}
                className="flex items-center gap-4 px-4 py-3"
              >
                <Avatar className="size-8">
                  <AvatarImage src={m.image ?? undefined} />
                  <AvatarFallback>
                    {(m.name ?? m.email)?.slice(0, 1).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium">{m.name ?? m.email}</p>
                  <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                </div>
                <Badge variant="secondary" className="capitalize">
                  {m.role}
                </Badge>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Video</span>
                  <Switch
                    checked={m.canGenerateVideo}
                    disabled={!canManage}
                    onCheckedChange={(checked) =>
                      patchMember(m.userId, { canGenerateVideo: checked })
                    }
                    aria-label={`Toggle video generation for ${m.email}`}
                  />
                </div>
              </li>
            ))}
            {members.length === 0 && (
              <li className="px-4 py-6 text-sm text-muted-foreground">
                No members yet.
              </li>
            )}
          </ul>
        )}
      </section>
    </div>
  );
}
