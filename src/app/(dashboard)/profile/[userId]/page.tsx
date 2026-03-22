import { ProfileClient } from "./profile-client";

export default async function UserProfilePage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight">
          Profile
        </h1>
        <p className="mt-1 text-muted-foreground">
          View stats, badges, and recent creations.
        </p>
      </div>
      <ProfileClient userId={userId} />
    </div>
  );
}
