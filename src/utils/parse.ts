const DURATION_PATTERN = /^(\d+(?:\.\d+)?)\s*(hr|hrs|hour|hours|h|m|min|mins|minute|minutes|d|day|days)$/i;

export function parseDuration(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  const match = trimmed.match(DURATION_PATTERN);
  if (!match) return null;

  const value = parseFloat(match[1]);
  const unit = match[2];

  if (!Number.isFinite(value) || value <= 0) return null;

  const multipliers: Record<string, number> = {
    m: 60_000,
    min: 60_000,
    mins: 60_000,
    minute: 60_000,
    minutes: 60_000,
    h: 3_600_000,
    hr: 3_600_000,
    hrs: 3_600_000,
    hour: 3_600_000,
    hours: 3_600_000,
    d: 86_400_000,
    day: 86_400_000,
    days: 86_400_000,
  };

  const ms = value * (multipliers[unit] ?? 0);
  return ms > 0 ? ms : null;
}

export function parseAmount(input: string): number | null {
  const cleaned = input.trim().replace(/,/g, '').replace(/\$/g, '');
  const value = parseFloat(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100) / 100;
}
