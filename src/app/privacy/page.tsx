// TODO: review with counsel before public launch — this is placeholder copy.
import Link from "next/link";

export const metadata = {
  title: "Privacy Policy · OpenCauldron",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Link
        href="/login"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Back to sign in
      </Link>
      <h1 className="mt-6 font-heading text-3xl font-bold tracking-tight">
        Privacy Policy
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Last updated: 2026-05-07
      </p>
      <div className="prose prose-invert mt-8 space-y-4 text-sm leading-relaxed text-muted-foreground">
        <p>
          <strong className="text-foreground">Replace before public launch.</strong>{" "}
          This Privacy Policy is placeholder copy for development. The
          production version will be reviewed by counsel before any public
          marketing or signup campaign.
        </p>
        <p>
          OpenCauldron stores the email address you sign in with, the prompts
          and assets you generate, and the workspace metadata needed to power
          collaboration. We share prompts with the AI provider you choose for
          each generation; we do not sell your data.
        </p>
        <p>
          You can request export or deletion of your account at any time by
          contacting support. Self-hosted installs keep all data inside your
          own infrastructure.
        </p>
      </div>
    </main>
  );
}
