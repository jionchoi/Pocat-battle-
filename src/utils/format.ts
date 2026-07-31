/**
 * Formatting helpers.
 *
 * Copy rules from DESIGN.md apply here: no exclamation marks, no "Oops!", active voice,
 * sentence case, no emoji.
 */

const RELATIVE_UNITS: [limitSeconds: number, divisor: number, unit: string][] = [
  [60, 1, 'second'],
  [3600, 60, 'minute'],
  [86_400, 3600, 'hour'],
  [604_800, 86_400, 'day'],
  [2_629_800, 604_800, 'week'],
  [31_557_600, 2_629_800, 'month'],
];

/** "3 hours ago", "just now". Never "Oops, unknown date". */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'unknown';

  const deltaSeconds = Math.max(0, (now - then) / 1000);
  if (deltaSeconds < 10) return 'just now';

  for (const [limit, divisor, unit] of RELATIVE_UNITS) {
    if (deltaSeconds < limit) {
      const value = Math.floor(deltaSeconds / divisor);
      return `${value} ${unit}${value === 1 ? '' : 's'} ago`;
    }
  }

  const years = Math.floor(deltaSeconds / 31_557_600);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

/**
 * "in 3 days", "in 4 hours", "today". Used for challenge countdowns.
 *
 * Deliberately coarse above an hour: a challenge closing in two days does not need a
 * second-accurate timer, and rendering one would mean re-rendering the hub every second.
 */
export function countdownLabel(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'soon';

  const seconds = (then - now) / 1000;
  if (seconds <= 0) return 'now';
  if (seconds < 3600) return `in ${Math.max(1, Math.floor(seconds / 60))} min`;
  if (seconds < 86_400) {
    const hours = Math.floor(seconds / 3600);
    return `in ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }

  const days = Math.floor(seconds / 86_400);
  return `in ${days} ${days === 1 ? 'day' : 'days'}`;
}

/**
 * Compact counts for leaderboards and profile stats. Deliberately not rounded to
 * suspiciously clean numbers.
 */
export function compactNumber(value: number): string {
  if (Math.abs(value) < 1000) return String(value);
  if (Math.abs(value) < 1_000_000) {
    const k = value / 1000;
    return `${k >= 10 ? Math.round(k) : k.toFixed(1)}k`;
  }
  return `${(value / 1_000_000).toFixed(1)}m`;
}

export function ordinalRank(rank: number): string {
  const mod100 = rank % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rank}th`;
  switch (rank % 10) {
    case 1:
      return `${rank}st`;
    case 2:
      return `${rank}nd`;
    case 3:
      return `${rank}rd`;
    default:
      return `${rank}th`;
  }
}

/** Metres for close range, one-decimal km beyond that. */
export function distanceLabel(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

/** Haversine distance in metres. Used for sighting proximity on the map. */
export function distanceBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Trim a nickname without cutting mid-word where avoidable. */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const slice = value.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(' ');
  const base = lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${base.trimEnd()}…`;
}

/**
 * Non-breaking space before the final word. iOS has no `textBreakStrategy`, so this is
 * how headings avoid a single orphaned word on the last line.
 */
export function preventOrphan(value: string): string {
  const lastSpace = value.lastIndexOf(' ');
  if (lastSpace === -1) return value;
  return `${value.slice(0, lastSpace)} ${value.slice(lastSpace + 1)}`;
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : plural ?? `${singular}s`}`;
}
