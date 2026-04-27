"use client";

/**
 * Workspace switcher (T136). Mounts inside the sidebar header next to the
 * org logo. Renders the current workspace's name; the dropdown trigger is
 * gated to hosted mode + multi-membership users (everyone else sees a
 * read-only pill so the chrome stays consistent).
 *
 * Switching writes the cookie consumed by `getCurrentWorkspace` and
 * full-reloads `/overview` so every server component re-resolves tenant
 * scope from the new value.
 */

import { useState } from "react";
import { Check, ChevronsUpDown, Plus, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

const COOKIE_NAME = "current_workspace_id";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "member";
}

interface Props {
  current: Workspace;
  memberships: Workspace[];
  /** Resolved server-side from `env.WORKSPACE_MODE` and forwarded as a prop. */
  mode: "hosted" | "self_hosted";
}

export function WorkspaceSwitcher({ current, memberships, mode }: Props) {
  const [open, setOpen] = useState(false);

  const canSwitch = mode === "hosted" && memberships.length >= 2;
  const canManage = current.role === "owner" || current.role === "admin";

  // Read-only chrome for self-hosted or single-membership users.
  if (!canSwitch) {
    return (
      <div
        data-slot="workspace-switcher"
        className="flex h-8 items-center gap-2 rounded-md px-2 text-sm group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
        aria-label={`Workspace: ${current.name}`}
      >
        <WorkspaceDot name={current.name} />
        <span className="truncate font-medium group-data-[collapsible=icon]:hidden">
          {current.name}
        </span>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            role="combobox"
            aria-label="Switch workspace"
            aria-expanded={open}
            data-slot="workspace-switcher"
            className="h-8 w-full justify-between gap-2 px-2 font-medium group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <WorkspaceDot name={current.name} />
              <span className="truncate group-data-[collapsible=icon]:hidden">
                {current.name}
              </span>
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 opacity-50 group-data-[collapsible=icon]:hidden" />
          </Button>
        }
      />

      <PopoverContent className="w-[260px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search workspaces…" />
          <CommandList>
            <CommandEmpty>No workspace found.</CommandEmpty>
            <CommandGroup heading="Workspaces">
              {memberships.map((ws) => (
                <CommandItem
                  key={ws.id}
                  value={ws.name}
                  onSelect={() => switchWorkspace(ws.id, current.id)}
                >
                  <WorkspaceDot name={ws.name} />
                  <span className="ml-2 flex-1 truncate">{ws.name}</span>
                  <Check
                    className={cn(
                      "ml-2 size-4",
                      ws.id === current.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>

            {canManage && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    value="manage-workspaces"
                    onSelect={() => {
                      window.location.assign("/workspaces");
                    }}
                  >
                    <Settings className="size-3.5" />
                    <span className="ml-2 flex-1">Manage workspaces</span>
                    <Plus className="size-3.5 opacity-60" />
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function switchWorkspace(nextId: string, currentId: string) {
  if (nextId === currentId) return;
  document.cookie = `${COOKIE_NAME}=${nextId}; path=/; max-age=${ONE_YEAR_SECONDS}`;
  window.location.assign("/overview");
}

/**
 * Tiny avatar dot — first letter of the workspace name on a tinted bg
 * derived from the name so two workspaces don't look identical at a glance.
 */
function WorkspaceDot({ name }: { name: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  const hue = hashHue(name);
  return (
    <span
      className="flex size-5 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold text-white"
      style={{ backgroundColor: `oklch(0.55 0.15 ${hue})` }}
      aria-hidden
    >
      {initial}
    </span>
  );
}

function hashHue(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}
