/**
 * /api/references compat shim (US1 / T021).
 *
 * TODO(library-dam Phase 6 / T044): remove this proxy after the compat-shim
 * release. The unified Library API at `/api/library` is the source of truth;
 * this shim exists for one release so external bookmarks of `/api/references`
 * (and any in-flight client deploy that hasn't picked up T022 yet) keep
 * working.
 *
 * The library route returns `{ items, nextCursor }`; the legacy references
 * client expects `{ references, nextCursor }` with a slightly narrower item
 * shape (no `source`/`tags`/`campaigns`/`embeddedAt`/`brandId`). The library
 * item shape is a SUPERSET of the references item shape, so we forward the
 * request to the library handler and rename the array key in-place.
 */

import { NextRequest, NextResponse } from "next/server";
import { GET as libraryGET } from "@/app/api/library/route";

export async function GET(req: NextRequest) {
  const upstream = await libraryGET(req);

  // 401 / 404 / 4xx — pass through verbatim.
  if (!upstream.ok) return upstream;

  const data = (await upstream.json()) as {
    items: unknown[];
    nextCursor: string | null;
  };
  return NextResponse.json({
    references: data.items,
    nextCursor: data.nextCursor,
  });
}
