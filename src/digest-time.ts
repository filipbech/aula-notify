function copenhagenOffsetMinutes(date: Date): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Copenhagen',
    timeZoneName: 'shortOffset',
  });
  const part = fmt.formatToParts(date).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+1';
  const match = part.match(/GMT([+-]\d+)/);
  return match ? Number.parseInt(match[1], 10) * 60 : 60;
}

/** Digest-to-digest day boundary: 17:00 Europe/Copenhagen, today if still ahead, else tomorrow. */
export function nextDailyDigestTime(now: Date): Date {
  const offsetMin = copenhagenOffsetMinutes(now);
  const cph = new Date(now.getTime() + offsetMin * 60_000);
  const y = cph.getUTCFullYear();
  const m = cph.getUTCMonth();
  const d = cph.getUTCDate();
  let targetUtcMs = Date.UTC(y, m, d, 17, 0, 0) - offsetMin * 60_000;
  if (targetUtcMs <= now.getTime()) {
    targetUtcMs = Date.UTC(y, m, d + 1, 17, 0, 0) - offsetMin * 60_000;
  }
  return new Date(targetUtcMs);
}
