/**
 * /api/references/[id] compat shim (US1 / T021).
 *
 * TODO(library-dam Phase 6 / T044): remove this proxy after the compat-shim
 * release. Forwards to `/api/library/[id]`'s DELETE handler — the only
 * verb the legacy references API exposed.
 *
 * GET/PATCH never existed on the references endpoint, so we don't proxy
 * those — clients hitting them on this URL get 405 Method Not Allowed
 * (Next.js's default for unimplemented verbs).
 */

import { NextRequest } from "next/server";
import { DELETE as libraryDELETE } from "@/app/api/library/[id]/route";

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return libraryDELETE(req, ctx);
}
