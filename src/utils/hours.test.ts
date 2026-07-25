import { getHoursDisplay } from './hours';
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

  it('skips a malformed period time and falls through to "Closed"', () => {
    setNow(12, 0);
    const result = getHoursDisplay(
      makeHours({ periods: [{ open: { day: 3, time: 'bad' } }] })
    );
    expect(result.timeUntil).toBe('Closed');
  });
});
