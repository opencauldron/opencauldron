"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BadgeIcon } from "@/components/badge-icon";
import {
  Flame,
  Lock,
  Zap,
  CalendarDays,
  Wand2,
  Star,
  Image as ImageIcon,
  Video,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface ProfileData {
  user: {
    id: string;
    name: string | null;
    image: string | null;
    hasVideoAccess: boolean;
    createdAt: string;
  };
  badges: {
    badgeId: string;
    name: string;
    description: string;
    icon: string;
    category: string;
    xpReward: number;
    earnedAt: string;
  }[];
  xp?: {
    level: number;
    title: string;
    currentXP: number;
    nextLevelXP: number | null;
    progress: number;
  };
  stats: {
    totalGenerations: number;
    favoriteModel: string | null;
    streak: number;
  };
  recentAssets: {
    id: string;
    mediaType: string;
    model: string;
    prompt: string;
    url: string;
    thumbnailUrl: string;
    width: number | null;
    height: number | null;
    createdAt: string;
  }[];
}

interface AllBadge {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  xpReward: number;
  sortOrder: number;
  earned: boolean;
  earnedAt: string | null;
}

interface ProfileClientProps {
  userId: string;
}

export function ProfileClient({ userId }: ProfileClientProps) {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [allBadges, setAllBadges] = useState<AllBadge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`/api/profile/${userId}`).then((r) => r.json()),
      fetch("/api/badges").then((r) => r.json()),
    ])
      .then(([profileData, badgesData]) => {
        setProfile(profileData);
        setAllBadges(badgesData.badges ?? []);
      })
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading) {
    return <ProfileSkeleton />;
  }

  if (!profile?.user) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        User not found.
      </div>
    );
  }

  const { user, badges: earnedBadges, xp, stats, recentAssets } = profile;
  const earnedSet = new Set(earnedBadges.map((b) => b.badgeId));

  const initials =
    user.name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase() ?? "?";

  const memberSince = new Date(user.createdAt).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const xpProgress = xp?.progress ?? 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <Card>
        <CardContent className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <Avatar className="h-20 w-20 ring-2 ring-primary/20" size="lg">
            <AvatarImage src={user.image ?? undefined} />
            <AvatarFallback className="bg-primary/10 text-lg font-semibold text-primary">
              {initials}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-heading text-2xl font-bold">
                {user.name ?? "Unknown User"}
              </h2>
              {user.hasVideoAccess && (
                <Badge variant="secondary">
                  <Video className="mr-1 h-3 w-3" />
                  Video Access
                </Badge>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5" />
                Member since {memberSince}
              </span>
              {stats.streak > 0 && (
                <span className="flex items-center gap-1.5 text-primary">
                  <Flame className="h-3.5 w-3.5" />
                  {stats.streak} day streak
                </span>
              )}
            </div>

            {/* Earned badge row */}
            {earnedBadges.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {earnedBadges.map((b) => (
                  <div
                    key={b.badgeId}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10"
                    title={b.name}
                  >
                    <BadgeIcon
                      name={b.icon}
                      className="h-4 w-4 text-primary"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* XP + Stats row */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {/* XP Level */}
        {xp && (
          <Card>
            <CardContent className="flex items-center gap-4">
              <div className="relative flex h-16 w-16 shrink-0 items-center justify-center">
                <svg
                  className="h-16 w-16 -rotate-90"
                  viewBox="0 0 64 64"
                >
                  <circle
                    cx="32"
                    cy="32"
                    r="28"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="4"
                    className="text-secondary"
                  />
                  <circle
                    cx="32"
                    cy="32"
                    r="28"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeDasharray={`${(xpProgress / 100) * 175.93} 175.93`}
                    strokeLinecap="round"
                    className="text-primary"
                  />
                </svg>
                <span className="absolute text-sm font-bold">
                  {xp.level}
                </span>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  {xp.title}
                </p>
                <p className="font-heading text-2xl font-bold">
                  {xp.currentXP} XP
                </p>
                <p className="text-xs text-muted-foreground">
                  {xp.nextLevelXP ? `${xp.nextLevelXP} XP to next level` : "Max level"}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Total Generations */}
        <Card>
          <CardContent className="flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-secondary">
              <Wand2 className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Generations
              </p>
              <p className="font-heading text-2xl font-bold">
                {stats.totalGenerations}
              </p>
              <p className="text-xs text-muted-foreground">
                all time
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Favorite Model */}
        <Card>
          <CardContent className="flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-secondary">
              <Star className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Favorite
              </p>
              <p className="font-heading text-lg font-bold truncate">
                {stats.favoriteModel ?? "N/A"}
              </p>
              <p className="text-xs text-muted-foreground">
                most used model
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Badge Showcase */}
      <div>
        <div className="mb-4 flex items-center gap-3">
          <h2 className="font-heading text-sm font-semibold uppercase tracking-widest text-muted-foreground/70">
            Feats
          </h2>
          <div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {allBadges.map((badge) => {
            const isEarned = earnedSet.has(badge.id);
            const earnedBadge = isEarned
              ? earnedBadges.find((b) => b.badgeId === badge.id)
              : null;

            return (
              <Card
                key={badge.id}
                className={
                  isEarned
                    ? "border-primary/30 bg-primary/5"
                    : "opacity-50"
                }
              >
                <CardContent className="flex items-start gap-3">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                      isEarned
                        ? "bg-primary/15"
                        : "bg-secondary"
                    }`}
                  >
                    {isEarned ? (
                      <BadgeIcon
                        name={badge.icon}
                        className="h-5 w-5 text-primary"
                      />
                    ) : (
                      <Lock className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-heading text-sm font-semibold truncate">
                      {badge.name}
                    </p>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {badge.description}
                    </p>
                    <div className="mt-1.5 flex items-center gap-2 text-xs">
                      {badge.xpReward > 0 && (
                        <span className="flex items-center gap-0.5 text-primary">
                          <Zap className="h-3 w-3" />+{badge.xpReward} XP
                        </span>
                      )}
                      {isEarned && earnedBadge && (
                        <span className="text-muted-foreground">
                          {formatDistanceToNow(new Date(earnedBadge.earnedAt), {
                            addSuffix: true,
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Recent Media */}
      {recentAssets.length > 0 && (
        <div>
          <div className="mb-4 flex items-center gap-3">
            <h2 className="font-heading text-sm font-semibold uppercase tracking-widest text-muted-foreground/70">
              Recent Creations
            </h2>
            <div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {recentAssets.map((asset) => (
              <div
                key={asset.id}
                className="group relative overflow-hidden rounded-xl border border-border/60 bg-secondary/30"
              >
                <div className="aspect-square">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={asset.thumbnailUrl}
                    alt={asset.prompt.slice(0, 60)}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    loading="lazy"
                  />
                </div>
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                  <div className="flex items-center gap-1.5">
                    {asset.mediaType === "video" ? (
                      <Video className="h-3 w-3 text-primary-foreground/70" />
                    ) : (
                      <ImageIcon className="h-3 w-3 text-primary-foreground/70" />
                    )}
                    <span className="truncate text-xs text-primary-foreground/90">
                      {asset.model}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="space-y-8">
      <Card>
        <CardContent className="flex items-center gap-6">
          <Skeleton className="h-20 w-20 rounded-full" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-32" />
            <div className="flex gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-8 rounded-full" />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent>
              <Skeleton className="h-16 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Card key={i}>
            <CardContent>
              <Skeleton className="h-14 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
