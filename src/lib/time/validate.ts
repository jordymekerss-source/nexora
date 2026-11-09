export type ClockRangeIssue =
  | "invalid_clock_in"
  | "invalid_clock_out"
  | "negative_or_zero_duration"
  | "break_exceeds_worked";

export function validateClockRange(params: {
  clockInIso: string;
  clockOutIso: string | null;
  breakMinutes: number;
}): ClockRangeIssue | null {
  const start = new Date(params.clockInIso).getTime();
  if (!Number.isFinite(start)) {
    return "invalid_clock_in";
  }

  if (params.clockOutIso === null) {
    if (params.breakMinutes < 0) {
      return "break_exceeds_worked";
    }
    return null;
  }

  const end = new Date(params.clockOutIso).getTime();
  if (!Number.isFinite(end)) {
    return "invalid_clock_out";
  }
  if (end <= start) {
    return "negative_or_zero_duration";
  }

  const worked = (end - start) / 60000;
  if (params.breakMinutes < 0 || params.breakMinutes > worked) {
    return "break_exceeds_worked";
  }
  return null;
}

/** Prefer server clock for "now" open sessions. */
export function serverNowIso(): string {
  return new Date().toISOString();
}
