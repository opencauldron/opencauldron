import { LeaderboardClient } from "./leaderboard-client";

export default function LeaderboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight">
          Leaderboard
        </h1>
        <p className="mt-1 text-muted-foreground">
          See who is leading in generations, badges, and credits earned.
        </p>
      </div>
      <LeaderboardClient />
    </div>
  );
}
