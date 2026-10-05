const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const numberFormat = new Intl.NumberFormat();

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateTime.format(new Date(iso)) : '—';
}

export function formatDate(iso: string | null | undefined): string {
  return iso ? dateOnly.format(new Date(iso)) : '—';
}

export function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : numberFormat.format(value);
}

/** "12 s ago", "5 min ago", "in 8 s". */
export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) {
    return 'never';
  }
  const diffMs = Date.parse(iso) - now;
  const future = diffMs > 0;
  const abs = Math.abs(diffMs);
  let text: string;
  if (abs < 5_000) {
    return 'just now';
  } else if (abs < 60_000) {
    text = `${Math.round(abs / 1000)} s`;
  } else if (abs < 3_600_000) {
    text = `${Math.round(abs / 60_000)} min`;
  } else if (abs < 86_400_000) {
    text = `${Math.round(abs / 3_600_000)} h`;
  } else {
    text = `${Math.round(abs / 86_400_000)} d`;
  }
  return future ? `in ${text}` : `${text} ago`;
}

/** 10000 -> "10 s", 90000 -> "1.5 min". */
export function formatInterval(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) {
    return '—';
  }
  if (ms < 60_000) {
    return `${Number((ms / 1000).toFixed(1))} s`;
  }
  return `${Number((ms / 60_000).toFixed(1))} min`;
}

export function formatScore(score: number | null, wickets: number | null): string {
  if (score === null) {
    return '—';
  }
  return wickets === null ? String(score) : `${score}/${wickets}`;
}

export function formatOvers(overs: number | null): string {
  return overs === null ? '—' : overs.toFixed(1).replace(/\.0$/, '');
}

export function teamLabel(team: { shortName: string | null; name: string | null }): string {
  return team.shortName ?? team.name ?? 'TBD';
}

/** Humanizes enum values: HOME_BANNER -> "Home banner". */
export function humanize(value: string): string {
  const text = value.replace(/[_-]+/g, ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
