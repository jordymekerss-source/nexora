/**
 * Strict user datetime parsing. Rejects Invalid Date instead of normalizing.
 * Accepts ISO-8601 and HTML datetime-local values.
 */
export function parseUserDateTime(value: string):
  | { ok: true; iso: string }
  | { ok: false; reason: "empty" | "invalid" } {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "empty" };
  }

  // datetime-local without seconds: treat as local wall time
  const normalized =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed) ? `${trimmed}:00` : trimmed;

  const ms = Date.parse(normalized);
  if (!Number.isFinite(ms)) {
    return { ok: false, reason: "invalid" };
  }

  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    return { ok: false, reason: "invalid" };
  }

  return { ok: true, iso: date.toISOString() };
}

export function parseBreakMinutes(raw: unknown):
  | { ok: true; minutes: number }
  | { ok: false; reason: "invalid" | "negative" } {
  if (raw === null || raw === undefined || raw === "") {
    return { ok: true, minutes: 0 };
  }
  if (typeof raw !== "string" && typeof raw !== "number") {
    return { ok: false, reason: "invalid" };
  }
  const n = typeof raw === "number" ? raw : Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { ok: false, reason: "invalid" };
  }
  if (n < 0) {
    return { ok: false, reason: "negative" };
  }
  return { ok: true, minutes: n };
}

/** Hard ceiling: one continuous shift longer than 36h is rejected. */
export const MAX_SHIFT_MS = 36 * 60 * 60 * 1000;
