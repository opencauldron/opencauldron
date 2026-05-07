import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role?: "admin" | "member";
      onboardingCompletedAt?: Date | null;
    } & DefaultSession["user"];
  }
}

export {};
