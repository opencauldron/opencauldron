"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRight, Trophy } from "lucide-react";

interface GeneratorEntry {
  userId: string;
  userName: string | null;
  userImage: string | null;
  count: number;
}

export function LeaderboardPreview() {
  const [generators, setGenerators] = useState<GeneratorEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/leaderboard")
      .then((r) => r.json())
      .then((data) => {
        setGenerators((data.topGenerators ?? []).slice(0, 5));
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-5 w-5 rounded-full" />
            <Skeleton className="h-6 w-6 rounded-full" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-10" />
          </div>
        ))}
      </div>
    );
  }

  if (generators.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        No activity this month.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {generators.map((entry, i) => {
        const initials =
          entry.userName
            ?.split(" ")
            .map((n) => n[0])
            .join("")
            .toUpperCase() ?? "?";

        return (
          <Link
            key={entry.userId}
            href={`/profile/${entry.userId}`}
            className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-secondary/60"
          >
            <span className="flex h-6 w-6 items-center justify-center text-xs font-semibold text-muted-foreground">
              {i + 1}
            </span>
            <Avatar size="sm">
              <AvatarImage src={entry.userImage ?? undefined} />
              <AvatarFallback className="text-[10px]">
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className="flex-1 truncate text-sm font-medium">
              {entry.userName ?? "Unknown"}
            </span>
            <span className="text-sm tabular-nums text-muted-foreground">
              {entry.count}
            </span>
          </Link>
        );
      })}

      <Link
        href="/leaderboard"
        className="mt-2 flex items-center gap-1.5 px-2 pt-2 text-sm font-medium text-primary transition-colors hover:text-primary/80"
      >
        View full leaderboard
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
