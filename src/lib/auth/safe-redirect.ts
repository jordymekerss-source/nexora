/**
 * Allow only same-origin relative paths. Blocks open redirects via //evil or absolute URLs.
 */
export function safeInternalPath(next: string | null | undefined, fallback = "/dashboard"): string {
  if (next === null || next === undefined) {
    return fallback;
  }
  const trimmed = next.trim();
  if (trimmed.length === 0) {
    return fallback;
  }
  if (!trimmed.startsWith("/")) {
    return fallback;
  }
  if (trimmed.startsWith("//") || trimmed.startsWith("/\\")) {
    return fallback;
  }
  if (trimmed.includes("://")) {
    return fallback;
  }
  return trimmed;
}
