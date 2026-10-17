import type { OpeningHours } from '../types';

interface HoursDisplay {
  todayHours: string | null; // "10:00 AM – 11:00 PM"
  timeUntil: string | null;  // "Opens in 2 hours" or "Closes in 3 hours"
  isOpen: boolean;
}

// Open or closed is worked out from the WEEKLY SCHEDULE (the periods Google sends: a day, 0 = Sunday, and a time like "0900") and the clock NOW. The
// "open_now" flag Google sends is only a snapshot from the moment the restaurant was fetched, and the server keeps a restaurant for up to 7 days, so
// it can be days out of date; it is used only when there is no schedule to read. Times are compared with the phone's clock.

const WEEK = 7 * 1440;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface Interval {
  start: number; // minutes into the week, 0 = Sunday 00:00
  end: number;   // may run past the end of the week (an overnight period on Saturday)
}

type Period = NonNullable<OpeningHours['periods']>[number];

function parseTime(timeStr: string | undefined): number | null {
  if (typeof timeStr !== 'string' || !/^\d{4}$/.test(timeStr)) return null;
  const hours = parseInt(timeStr.slice(0, 2), 10);
  const mins = parseInt(timeStr.slice(2), 10);
  if (hours > 24 || mins > 59) return null;
  return hours * 60 + mins;
}

const validDay = (d: unknown): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6;

interface Schedule {
  // a period with no closing time: open all the time (Google sends a single such period for a 24-hour place)
  alwaysOpen: boolean;
  intervals: Interval[];
}

// null when there is nothing usable to read
function readSchedule(periods: Period[] | undefined): Schedule | null {
  if (!periods || periods.length === 0) return null;
  let alwaysOpen = false;
  const intervals: Interval[] = [];
  for (const p of periods) {
    const openTime = parseTime(p?.open?.time);
    if (!validDay(p?.open?.day) || openTime === null) continue;
    if (!p.close) {
      alwaysOpen = true;
      continue;
    }
    const closeTime = parseTime(p.close.time);
    if (!validDay(p.close.day) || closeTime === null) continue;
    const start = p.open.day * 1440 + openTime;
    let end = p.close.day * 1440 + closeTime;
    if (end <= start) end += WEEK;   // closes after midnight, or after the week turns over
    intervals.push({ start, end });
  }
  if (!alwaysOpen && intervals.length === 0) return null;
  return { alwaysOpen, intervals };
}

// Each interval and a copy one week later, sorted, with intervals that touch or overlap joined (open until 2 AM, then open again at 2 AM, is one
// stretch). A moment in the week is then looked up at its own minute and at the same minute a week on.
function mergedWithNextWeek(intervals: Interval[]): Interval[] {
  const all = intervals.flatMap((i) => [i, { start: i.start + WEEK, end: i.end + WEEK }]).sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const i of all) {
    const last = merged[merged.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else merged.push({ ...i });
  }
  return merged;
}

function minuteOfWeek(now: Date): number {
  return now.getDay() * 1440 + now.getHours() * 60 + now.getMinutes();
}

interface Status {
  isOpen: boolean;
  timeUntil: string | null;
}

function statusFromSchedule(schedule: Schedule, now: Date): Status {
  if (schedule.alwaysOpen) return { isOpen: true, timeUntil: null };
  const nowMin = minuteOfWeek(now);
  const merged = mergedWithNextWeek(schedule.intervals);

  for (const m of [nowMin, nowMin + WEEK]) {
    const inside = merged.find((i) => i.start <= m && m < i.end);
    if (inside) return { isOpen: true, timeUntil: formatTimeDelta(inside.end - m, 'Closes in') };
  }

  // closed: when does it open next (within the coming week)?
  const next = merged.find((i) => i.start > nowMin);
  if (!next) return { isOpen: false, timeUntil: 'Closed' };
  const dayOfNext = Math.floor(next.start / 1440) % 7;
  const today = now.getDay();
  if (dayOfNext === today && next.start - nowMin < 1440) return { isOpen: false, timeUntil: formatTimeDelta(next.start - nowMin, 'Opens in') };
  if (dayOfNext === (today + 1) % 7) return { isOpen: false, timeUntil: 'Opens tomorrow' };
  return { isOpen: false, timeUntil: 'Closed' };
}

// Today's line from Google's list ("Wednesday: 9:00 AM – 9:00 PM"), found by the name of the day. Google's list starts on Monday, not Sunday, so
// the position of a line is not the day of the week.
function todayText(weekdayText: string[] | undefined, now: Date): string | null {
  if (!weekdayText || weekdayText.length === 0) return null;
  const name = DAY_NAMES[now.getDay()].toLowerCase();
  const line = weekdayText.find((l) => typeof l === 'string' && l.trim().toLowerCase().startsWith(`${name}:`));
  if (!line) return null;
  const at = line.indexOf(': ');
  return at === -1 ? null : line.slice(at + 2).trim() || null;
}

export function getHoursDisplay(hours: OpeningHours | undefined, now: Date = new Date()): HoursDisplay {
  if (!hours) return { todayHours: null, timeUntil: null, isOpen: false };

  const todayHours = todayText(hours.weekday_text, now);
  const schedule = readSchedule(hours.periods);
  // no schedule to read: the stored snapshot is all there is
  if (!schedule) return { todayHours, timeUntil: null, isOpen: hours.open_now ?? false };

  const status = statusFromSchedule(schedule, now);
  return { todayHours, timeUntil: status.timeUntil, isOpen: status.isOpen };
}

/** Is this restaurant open right now? From its weekly schedule and the clock; the stored "open now" snapshot only when it has no schedule. */
export function isRestaurantOpen(restaurant: { openNow?: boolean; openingHours?: OpeningHours }, now: Date = new Date()): boolean {
  if (restaurant.openingHours) {
    const schedule = readSchedule(restaurant.openingHours.periods);
    if (schedule) return statusFromSchedule(schedule, now).isOpen;
    if (typeof restaurant.openingHours.open_now === 'boolean') return restaurant.openingHours.open_now;
  }
  return restaurant.openNow ?? false;
}

function formatTimeDelta(minutes: number, prefix: string): string {
  if (minutes < 60) {
    return `${prefix} ${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) {
    return `${prefix} ${hours}h`;
  }
  return `${prefix} ${hours}h ${mins}m`;
}
