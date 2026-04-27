import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/lib/db";
import {
  users,
  accounts,
  sessions,
  verificationTokens,
  workspaceMembers,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { bootstrapHostedSignup } from "@/lib/workspace/bootstrap";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  events: {
    async createUser({ user }) {
      // First-time signup hook (FR-001 / FR-006). In hosted mode we mint a
      // workspace + Personal brand for the new user. Self-hosted skips this
      // because the bootstrap CLI runs once at install.
      if (env.WORKSPACE_MODE !== "hosted") return;
      if (!user.id) return;
      try {
        await bootstrapHostedSignup({
          userId: user.id,
          preferredName: user.name ? `${user.name}'s Studio` : undefined,
        });
      } catch (err) {
        console.error("bootstrapHostedSignup failed", err);
      }
    },
  },
  callbacks: {
    async signIn({ user }) {
      const email = user.email;
      if (!email) return false;

      const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN;
      if (allowedDomain && !email.endsWith(`@${allowedDomain}`)) {
        return false;
      }

      return true;
    },
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
        const dbUser = await db
          .select({ role: users.role })
          .from(users)
          .where(eq(users.id, user.id))
          .limit(1);
        (session.user as unknown as Record<string, unknown>).role =
          dbUser[0]?.role ?? "member";

        // Defensive backfill — if a user exists but has no workspace member
        // row (e.g. legacy account predating the bootstrap event), create
        // one now. Idempotent.
        if (env.WORKSPACE_MODE === "hosted") {
          const memberRows = await db
            .select({ workspaceId: workspaceMembers.workspaceId })
            .from(workspaceMembers)
            .where(eq(workspaceMembers.userId, user.id))
            .limit(1);
          if (memberRows.length === 0) {
            try {
              await bootstrapHostedSignup({ userId: user.id });
            } catch (err) {
              console.error("hosted bootstrap (session backfill) failed", err);
            }
          }
        }
      }
      return session;
    },
  },
});
