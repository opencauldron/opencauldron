/**
 * Normalize imageInput from either the old single-string format or
 * the new string-array format into a consistent string[].
 */
export function normalizeImageInputs(val: unknown): string[] {
  if (!val) return [];
  if (typeof val === "string") return val ? [val] : [];
  if (Array.isArray(val))
    return val.filter((v): v is string => typeof v === "string" && v.length > 0);
  return [];
}
