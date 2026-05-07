// TODO: review with counsel before public launch — this is placeholder copy.
import Link from "next/link";

export const metadata = {
  title: "Terms of Service · OpenCauldron",
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Link
        href="/login"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Back to sign in
      </Link>
      <h1 className="mt-6 font-heading text-3xl font-bold tracking-tight">
        Terms of Service
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Last updated: 2026-05-07
      </p>
      <div className="prose prose-invert mt-8 space-y-4 text-sm leading-relaxed text-muted-foreground">
        <p>
          <strong className="text-foreground">Replace before public launch.</strong>{" "}
          These Terms of Service are placeholder copy for development. The
          production version will be reviewed by counsel before any public
          marketing or signup campaign.
        </p>
        <p>
          By using OpenCauldron, you agree not to misuse the service, generate
          content that violates applicable law, or circumvent rate limits or
          provider policies. You retain rights to content you generate, subject
          to the licenses of the upstream model providers.
        </p>
        <p>
          OpenCauldron is provided &quot;as is&quot; without warranty. We may
          suspend accounts that abuse the service or threaten its availability
          for other users.
        </p>
      </div>
    </main>
  );
}
