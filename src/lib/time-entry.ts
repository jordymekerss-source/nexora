export function computeWorkedMinutes(params: {
  clockIn: string;
  clockOut: string | null;
  breakMinutes: number;
}): number {
  const start = new Date(params.clockIn).getTime();
  const end = params.clockOut === null ? Date.now() : new Date(params.clockOut).getTime();

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 0;
  }

  const diffMinutes = (end - start) / 60000;
  const net = diffMinutes - Math.max(0, params.breakMinutes);
  return Math.max(0, net);
}
