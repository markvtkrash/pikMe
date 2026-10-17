import { getHoursDisplay, isRestaurantOpen } from './hours';
import type { OpeningHours } from '../types';

// Wednesday, Jan 3 2024 → Date.getDay() === 3
function setNow(hour: number, minute: number) {
  jest.setSystemTime(new Date(2024, 0, 3, hour, minute));
}

const WEEKDAY_TEXT = [
  'Sunday: 9:00 AM – 9:00 PM',
  'Monday: 9:00 AM – 9:00 PM',
  'Tuesday: 9:00 AM – 9:00 PM',
  'Wednesday: 9:00 AM – 9:00 PM',
  'Thursday: 9:00 AM – 9:00 PM',
  'Friday: 9:00 AM – 10:00 PM',
  'Saturday: 9:00 AM – 10:00 PM',
];

function makeHours(overrides: Partial<OpeningHours> = {}): OpeningHours {
  return {
    open_now: true,
    weekday_text: WEEKDAY_TEXT,
    periods: [{ open: { day: 3, time: '0900' }, close: { day: 3, time: '2100' } }],
    ...overrides,
  };
}

describe('getHoursDisplay', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns nulls and isOpen=false when hours is undefined', () => {
    setNow(12, 0);
    const result = getHoursDisplay(undefined);
    expect(result).toEqual({ todayHours: null, timeUntil: null, isOpen: false });
  });

  it('returns nulls and falls back to open_now when weekday_text is empty', () => {
    setNow(12, 0);
    const result = getHoursDisplay({ open_now: true, weekday_text: [] });
    expect(result).toEqual({ todayHours: null, timeUntil: null, isOpen: true });
  });

  it('extracts today\'s hours string from weekday_text', () => {
    setNow(12, 0);
    const result = getHoursDisplay(makeHours());
    expect(result.todayHours).toBe('9:00 AM – 9:00 PM');
  });

  it('returns null todayHours when weekday_text has no entry for today', () => {
    setNow(12, 0);
    const result = getHoursDisplay(makeHours({ weekday_text: ['Sunday: 9:00 AM – 9:00 PM'] }));
    expect(result.todayHours).toBeNull();
  });

  it('reports "Opens in Xh Ym" before opening time', () => {
    setNow(7, 15); // 1h45m before 09:00 open
    const result = getHoursDisplay(makeHours());
    expect(result.timeUntil).toBe('Opens in 1h 45m');
  });

  it('reports "Opens in Xm" when under an hour before opening', () => {
    setNow(8, 40); // 20m before 09:00 open
    const result = getHoursDisplay(makeHours());
    expect(result.timeUntil).toBe('Opens in 20m');
  });

  it('reports "Closes in Xh" with no remainder minutes', () => {
    setNow(19, 0); // exactly 2h before 21:00 close
    const result = getHoursDisplay(makeHours());
    expect(result.timeUntil).toBe('Closes in 2h');
  });

  it('reports "Closes in Xh Ym" while open with a remainder', () => {
    setNow(19, 30); // 1h30m before 21:00 close
    const result = getHoursDisplay(makeHours());
    expect(result.timeUntil).toBe('Closes in 1h 30m');
  });

  it('reports "Opens tomorrow" when past close and tomorrow has periods', () => {
    setNow(22, 0); // past 21:00 close
    const hours = makeHours({
      periods: [
        { open: { day: 3, time: '0900' }, close: { day: 3, time: '2100' } },
        { open: { day: 4, time: '0900' }, close: { day: 4, time: '2100' } },
      ],
    });
    const result = getHoursDisplay(hours);
    expect(result.timeUntil).toBe('Opens tomorrow');
  });

  it('reports "Closed" when past close and no periods tomorrow', () => {
    setNow(22, 0); // past 21:00 close, no periods for day 4
    const result = getHoursDisplay(makeHours());
    expect(result.timeUntil).toBe('Closed');
  });

  it('returns null timeUntil when periods is undefined', () => {
    setNow(12, 0);
    const result = getHoursDisplay(makeHours({ periods: undefined }));
    expect(result.timeUntil).toBeNull();
  });

  it('returns null timeUntil when periods is an empty array', () => {
    setNow(12, 0);
    const result = getHoursDisplay(makeHours({ periods: [] }));
    expect(result.timeUntil).toBeNull();
  });

  it('a schedule with nothing readable in it counts as no schedule: no countdown, and the stored snapshot decides', () => {
    setNow(12, 0);
    const result = getHoursDisplay(makeHours({ open_now: true, periods: [{ open: { day: 3, time: 'bad' } }] }));
    expect(result.timeUntil).toBeNull();
    expect(result.isOpen).toBe(true);
  });
});

// ── open or closed from the weekly schedule and the clock, not the stored snapshot ──
// 2024-01-03 is a Wednesday (day 3). Google's day numbers: 0 = Sunday.
const at = (day: number, hour: number, minute = 0) => new Date(2024, 0, 7 + day, hour, minute); // 2024-01-07 is a Sunday (day 0)

const daily = (open: string, close: string, days = [0, 1, 2, 3, 4, 5, 6]) =>
  days.map((d) => ({ open: { day: d, time: open }, close: { day: d, time: close } }));

const hoursWith = (periods: OpeningHours['periods'], open_now = false): OpeningHours => ({ open_now, weekday_text: [], periods });

describe('open or closed comes from the schedule, not the stored snapshot', () => {
  it('the stored snapshot says closed but the schedule says open now: open (the Costa Vida case)', () => {
    const hours = hoursWith(daily('1100', '2100'), false);
    expect(getHoursDisplay(hours, at(3, 13, 30)).isOpen).toBe(true);
  });
  it('the stored snapshot says open but the schedule says closed: closed', () => {
    const hours = hoursWith(daily('1100', '2100'), true);
    expect(getHoursDisplay(hours, at(3, 22, 30)).isOpen).toBe(false);
  });
  it('open from the opening minute, closed from the closing minute', () => {
    const hours = hoursWith(daily('1100', '2100'));
    expect(getHoursDisplay(hours, at(3, 10, 59)).isOpen).toBe(false);
    expect(getHoursDisplay(hours, at(3, 11, 0)).isOpen).toBe(true);
    expect(getHoursDisplay(hours, at(3, 20, 59)).isOpen).toBe(true);
    expect(getHoursDisplay(hours, at(3, 21, 0)).isOpen).toBe(false);
  });
  it('a day with no period is closed all day', () => {
    const hours = hoursWith(daily('1100', '2100', [1, 2, 3, 4, 5, 6])); // closed on Sunday
    expect(getHoursDisplay(hours, at(0, 13)).isOpen).toBe(false);
    expect(getHoursDisplay(hours, at(1, 13)).isOpen).toBe(true);
  });
  it('a lunch break: open, closed, open again', () => {
    const hours = hoursWith([
      { open: { day: 3, time: '1100' }, close: { day: 3, time: '1400' } },
      { open: { day: 3, time: '1700' }, close: { day: 3, time: '2200' } },
    ]);
    expect(getHoursDisplay(hours, at(3, 12)).isOpen).toBe(true);
    expect(getHoursDisplay(hours, at(3, 15)).isOpen).toBe(false);
    expect(getHoursDisplay(hours, at(3, 15)).timeUntil).toBe('Opens in 2h');
    expect(getHoursDisplay(hours, at(3, 18)).isOpen).toBe(true);
  });
});

describe('overnight hours', () => {
  const bar = hoursWith([{ open: { day: 5, time: '1800' }, close: { day: 6, time: '0200' } }]); // Friday 6 PM to Saturday 2 AM
  it('is open late on the opening day', () => {
    expect(getHoursDisplay(bar, at(5, 23)).isOpen).toBe(true);
  });
  it('is still open after midnight, on the next day', () => {
    expect(getHoursDisplay(bar, at(6, 1)).isOpen).toBe(true);
    expect(getHoursDisplay(bar, at(6, 1)).timeUntil).toBe('Closes in 1h');
  });
  it('is closed once it has closed, and before it opens', () => {
    expect(getHoursDisplay(bar, at(6, 2)).isOpen).toBe(false);
    expect(getHoursDisplay(bar, at(5, 17)).isOpen).toBe(false);
  });
  it('the week turning over: Saturday night into Sunday morning', () => {
    const sat = hoursWith([{ open: { day: 6, time: '2000' }, close: { day: 0, time: '0300' } }]);
    expect(getHoursDisplay(sat, at(6, 23)).isOpen).toBe(true);
    expect(getHoursDisplay(sat, at(0, 1)).isOpen).toBe(true);
    expect(getHoursDisplay(sat, at(0, 1)).timeUntil).toBe('Closes in 2h');
    expect(getHoursDisplay(sat, at(0, 4)).isOpen).toBe(false);
  });
  it('back-to-back periods that meet at midnight are one stretch', () => {
    const run = hoursWith([
      { open: { day: 3, time: '1800' }, close: { day: 4, time: '0000' } },
      { open: { day: 4, time: '0000' }, close: { day: 4, time: '0200' } },
    ]);
    expect(getHoursDisplay(run, at(3, 23)).timeUntil).toBe('Closes in 3h');
  });
  it('a close at 2400 is midnight', () => {
    const late = hoursWith([{ open: { day: 3, time: '1800' }, close: { day: 3, time: '2400' } }]);
    expect(getHoursDisplay(late, at(3, 23, 30)).isOpen).toBe(true);
    expect(getHoursDisplay(late, at(4, 0, 30)).isOpen).toBe(false);
  });
});

describe('open 24 hours', () => {
  it('a single period with no closing time is open at every moment', () => {
    const all = hoursWith([{ open: { day: 0, time: '0000' } }]);
    for (const [d, h] of [[0, 0], [3, 3], [6, 23]]) expect(getHoursDisplay(all, at(d, h)).isOpen).toBe(true);
    expect(getHoursDisplay(all, at(3, 3)).timeUntil).toBeNull();
  });
});

describe('what it says when closed', () => {
  const hours = hoursWith(daily('1100', '2100'));
  it('opens later today', () => {
    expect(getHoursDisplay(hours, at(3, 9, 30)).timeUntil).toBe('Opens in 1h 30m');
  });
  it('opens tomorrow once today is over', () => {
    expect(getHoursDisplay(hours, at(3, 22)).timeUntil).toBe('Opens tomorrow');
  });
  it('opens tomorrow across the week turning over (Saturday night, open on Sunday)', () => {
    expect(getHoursDisplay(hours, at(6, 22)).timeUntil).toBe('Opens tomorrow');
  });
  it('is just "Closed" when it will not open tomorrow', () => {
    const wedOnly = hoursWith(daily('1100', '2100', [3]));
    expect(getHoursDisplay(wedOnly, at(3, 22)).timeUntil).toBe('Closed');
    expect(getHoursDisplay(wedOnly, at(0, 12)).timeUntil).toBe('Closed');
  });
  it('says when it closes while open', () => {
    expect(getHoursDisplay(hours, at(3, 20)).timeUntil).toBe('Closes in 1h');
    expect(getHoursDisplay(hours, at(3, 20, 45)).timeUntil).toBe('Closes in 15m');
  });
});

describe("today's hours are found by the name of the day (Google's list starts on Monday)", () => {
  const MONDAY_FIRST = [
    'Monday: 11:00 AM – 9:00 PM',
    'Tuesday: 11:00 AM – 9:00 PM',
    'Wednesday: 11:00 AM – 9:30 PM',
    'Thursday: 11:00 AM – 9:00 PM',
    'Friday: 11:00 AM – 10:00 PM',
    'Saturday: 11:00 AM – 10:00 PM',
    'Sunday: Closed',
  ];
  const withText = (text: string[]): OpeningHours => ({ open_now: true, weekday_text: text, periods: daily('1100', '2100') });
  it('a Wednesday shows Wednesday, not Thursday', () => {
    expect(getHoursDisplay(withText(MONDAY_FIRST), at(3, 12)).todayHours).toBe('11:00 AM – 9:30 PM');
  });
  it('every day of the week finds its own line', () => {
    const expected = ['Closed', '11:00 AM – 9:00 PM', '11:00 AM – 9:00 PM', '11:00 AM – 9:30 PM', '11:00 AM – 9:00 PM', '11:00 AM – 10:00 PM', '11:00 AM – 10:00 PM'];
    for (let d = 0; d < 7; d++) expect(getHoursDisplay(withText(MONDAY_FIRST), at(d, 12)).todayHours).toBe(expected[d]);
  });
  it('a Sunday-first list works the same', () => {
    const sundayFirst = [MONDAY_FIRST[6], ...MONDAY_FIRST.slice(0, 6)];
    expect(getHoursDisplay(withText(sundayFirst), at(3, 12)).todayHours).toBe('11:00 AM – 9:30 PM');
  });
  it('is not case sensitive and copes with a missing day', () => {
    expect(getHoursDisplay(withText(['wednesday: 8 AM – 5 PM']), at(3, 12)).todayHours).toBe('8 AM – 5 PM');
    expect(getHoursDisplay(withText(['Monday: 8 AM – 5 PM']), at(3, 12)).todayHours).toBeNull();
  });
  it('keeps the colons inside the times', () => {
    expect(getHoursDisplay(withText(['Wednesday: 10:30 AM – 9:45 PM']), at(3, 12)).todayHours).toBe('10:30 AM – 9:45 PM');
  });
});

describe('isRestaurantOpen', () => {
  it('uses the schedule when there is one, whatever the stored flags say', () => {
    const r = { openNow: false, openingHours: hoursWith(daily('1100', '2100'), false) };
    expect(isRestaurantOpen(r, at(3, 13))).toBe(true);
    expect(isRestaurantOpen({ ...r, openNow: true }, at(3, 23))).toBe(false);
  });
  it('without a schedule, uses the snapshot inside the hours, then the restaurant flag', () => {
    expect(isRestaurantOpen({ openNow: false, openingHours: { open_now: true, weekday_text: [] } }, at(3, 13))).toBe(true);
    expect(isRestaurantOpen({ openNow: true, openingHours: { open_now: false, weekday_text: [] } }, at(3, 13))).toBe(false);
    expect(isRestaurantOpen({ openNow: true }, at(3, 13))).toBe(true);
    expect(isRestaurantOpen({ openNow: false }, at(3, 13))).toBe(false);
    expect(isRestaurantOpen({}, at(3, 13))).toBe(false);
  });
  it('a schedule of unreadable periods falls back to the snapshot', () => {
    const r = { openNow: false, openingHours: hoursWith([{ open: { day: 3, time: 'bad' } }], true) };
    expect(isRestaurantOpen(r, at(3, 13))).toBe(true);
  });
  it('ignores impossible days and times', () => {
    const r = { openingHours: hoursWith([{ open: { day: 9, time: '1100' }, close: { day: 9, time: '2100' } }, { open: { day: 3, time: '9999' }, close: { day: 3, time: '2100' } }], true) };
    expect(isRestaurantOpen(r, at(3, 13))).toBe(true); // nothing readable, so the snapshot
  });
});

