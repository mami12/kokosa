import type { Match } from '../types';
const ordinal = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const kickoffDay = (value: unknown) => {
  const date = new Date(String(value ?? ''));
  if (!Number.isFinite(date.getTime())) return Number.MAX_SAFE_INTEGER;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Tirane', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return Number(parts.year + parts.month + parts.day);
};
/** LIVE first; PREMATCH competition priority globally, then Tirana kickoff date within each priority. */
export function compareMatchDisplay(a: Match, b: Match): number {
  const aLive=a.status==='LIVE', bLive=b.status==='LIVE';
  return Number(bLive) - Number(aLive)
    || (!aLive ? ordinal(a.listingPriority)-ordinal(b.listingPriority) : 0)
    || (!aLive ? kickoffDay(a.startTime) - kickoffDay(b.startTime) : 0)
    || ordinal(a.competitionOrder) - ordinal(b.competitionOrder)
    || String(a.tournament?.id ?? a.tournamentId ?? '').localeCompare(String(b.tournament?.id ?? b.tournamentId ?? ''), 'en', { numeric: true })
    || ordinal(a.displayOrder) - ordinal(b.displayOrder)
    || new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    || String(a.id).localeCompare(String(b.id), 'en', { numeric: true });
}
