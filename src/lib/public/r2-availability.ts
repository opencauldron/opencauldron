// Runtime gate for the public-sharing feature (D14 / FR-017).
//
// Public campaign galleries serve image bytes directly from Cloudflare R2's
// public URL. When `R2_PUBLIC_URL` is unset (typical for self-hosted Docker
// installs that haven't configured a public bucket), the feature must be
// inert end-to-end:
//   - The dashboard server component (T014) calls this to decide whether to
//     render the Visibility section. When false, the toggle is hidden and a
//     tooltip explains the requirement to operators.
//   - The visibility API route (T009) calls this to gate `publish` and
//     `regenerate` actions. When false, the route returns 412
//     PRECONDITION_FAILED with machine code `r2_public_url_unset`.
// `unpublish` intentionally remains available even when this returns false,
// so operators can revoke prior public links after losing the env var.

export function isPublicSharingAvailable(): boolean {
  return Boolean(process.env.R2_PUBLIC_URL);
}
