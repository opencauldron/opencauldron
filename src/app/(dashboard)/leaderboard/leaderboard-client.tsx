"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Trophy, Award, Zap } from "lucide-react";

interface LeaderboardEntry {
  userId: string;
  userName: string | null;
  userImage: string | null;
}

interface GeneratorEntry extends LeaderboardEntry {
  count: number;
}

interface BadgeEntry extends LeaderboardEntry {
  badgeCount: number;
}

interface XPEntry extends LeaderboardEntry {
  xp: number;
  level: number;
}

interface LeaderboardData {
  topGenerators: GeneratorEntry[];
  mostBadges: BadgeEntry[];
  highestXP: XPEntry[];
}

function getInitials(name: string | null) {
  return (
    name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase() ?? "?"
  );
}

function RankIndicator({ rank }: { rank: number }) {
  if (rank === 1)
    return (
      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
        1
      </div>
    );
  if (rank === 2)
    return (
      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-xs font-bold text-muted-foreground">
        2
      </div>
    );
  if (rank === 3)
    return (
      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-xs font-bold text-muted-foreground">
        3
      </div>
    );
  return (
    <div className="flex h-7 w-7 items-center justify-center text-xs text-muted-foreground">
      {rank}
    </div>
  );
}

export function LeaderboardClient() {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/leaderboard")
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <LeaderboardSkeleton />;
  }

  if (!data) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        Could not load leaderboard data.
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Top Generators */}
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-primary" />
            Top Generators
          </CardTitle>
          <p className="text-xs text-muted-foreground">This month</p>
        </CardHeader>
        <CardContent className="space-y-1 pt-2">
          {data.topGenerators.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No activity this month.
            </p>
          )}
          {data.topGenerators.map((entry, i) => (
            <Link
              key={entry.userId}
              href={`/profile/${entry.userId}`}
              className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-secondary/60"
            >
              <RankIndicator rank={i + 1} />
              <Avatar size="sm">
                <AvatarImage src={entry.userImage ?? undefined} />
                <AvatarFallback className="text-[10px]">
                  {getInitials(entry.userName)}
                </AvatarFallback>
              </Avatar>
              <span className="flex-1 truncate text-sm font-medium">
                {entry.userName ?? "Unknown"}
              </span>
              <span className="text-sm font-semibold tabular-nums">
                {entry.count}
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>

      {/* Most Feats */}
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <Award className="h-4 w-4 text-primary" />
            Most Feats
          </CardTitle>
          <p className="text-xs text-muted-foreground">All time</p>
        </CardHeader>
        <CardContent className="space-y-1 pt-2">
          {data.mostBadges.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No feats earned yet.
            </p>
          )}
          {data.mostBadges.map((entry, i) => (
            <Link
              key={entry.userId}
              href={`/profile/${entry.userId}`}
              className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-secondary/60"
            >
              <RankIndicator rank={i + 1} />
              <Avatar size="sm">
                <AvatarImage src={entry.userImage ?? undefined} />
                <AvatarFallback className="text-[10px]">
                  {getInitials(entry.userName)}
                </AvatarFallback>
              </Avatar>
              <span className="flex-1 truncate text-sm font-medium">
                {entry.userName ?? "Unknown"}
              </span>
              <span className="text-sm font-semibold tabular-nums">
                {entry.badgeCount}
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>

      {/* Highest XP */}
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            Highest XP
          </CardTitle>
          <p className="text-xs text-muted-foreground">All time</p>
        </CardHeader>
        <CardContent className="space-y-1 pt-2">
          {data.highestXP.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No XP earned yet.
            </p>
          )}
          {data.highestXP.map((entry, i) => (
            <Link
              key={entry.userId}
              href={`/profile/${entry.userId}`}
              className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-secondary/60"
            >
              <RankIndicator rank={i + 1} />
              <Avatar size="sm">
                <AvatarImage src={entry.userImage ?? undefined} />
                <AvatarFallback className="text-[10px]">
                  {getInitials(entry.userName)}
                </AvatarFallback>
              </Avatar>
              <span className="flex-1 truncate text-sm font-medium">
                {entry.userName ?? "Unknown"}
              </span>
              <span className="text-sm font-semibold tabular-nums">
                {entry.xp} XP
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function LeaderboardSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {Array.from({ length: 3 }).map((_, col) => (
        <Card key={col}>
          <CardHeader className="border-b">
            <Skeleton className="h-5 w-32" />
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-7 w-7 rounded-full" />
                <Skeleton className="h-6 w-6 rounded-full" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-8" />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
