import { BUILDS_PER_RUN_OPTIONS, PLACE_PER_DAY_OPTIONS, describeBuildStatus, describeSchedule, formatLastRun } from './chainMenuSources';

const base = { cron_installed: true, job_scheduled: true, job_active: true, per_run: 3, configured: true, queued_count: 12 };

describe('describeSchedule', () => {
  it('reads an hourly schedule in plain words and shows anything else as written', () => {
    expect(describeSchedule('7 * * * *')).toBe('hourly at :07');
    expect(describeSchedule('45 * * * *')).toBe('hourly at :45');
    expect(describeSchedule('0 3 * * *')).toBe('0 3 * * *');
    expect(describeSchedule('7,37 * * * *')).toBe('every 30 minutes (at :07 and :37)');
    expect(describeSchedule('5,20 * * * *')).toBe('twice an hour (at :05 and :20)');
    expect(describeSchedule(null)).toBe('not scheduled');
  });
});

describe('describeBuildStatus', () => {
  it('reports the first thing that is wrong, in order', () => {
    expect(describeBuildStatus({ ...base, cron_installed: false })).toEqual({ label: 'pg_cron is not installed', tone: 'bad' });
    expect(describeBuildStatus({ ...base, job_scheduled: false }).label).toBe('Not scheduled');
    expect(describeBuildStatus({ ...base, job_active: false }).tone).toBe('warn');
    expect(describeBuildStatus({ ...base, configured: false }).label).toBe('Key not stored yet');
    expect(describeBuildStatus({ ...base, per_run: 0 }).label).toBe('Paused');
  });

  it('shows how many are waiting when it is running', () => {
    expect(describeBuildStatus(base)).toEqual({ label: 'On · 3 per run · 12 waiting', tone: 'good' });
  });
});

describe('formatLastRun', () => {
  const now = new Date('2026-10-05T12:00:00Z');

  it('handles never, minutes, hours and days, with the outcome', () => {
    expect(formatLastRun(null, null, now)).toBe('never');
    expect(formatLastRun('garbage', null, now)).toBe('never');
    expect(formatLastRun('2026-10-05T11:59:40Z', 'succeeded', now)).toBe('just now (succeeded)');
    expect(formatLastRun('2026-10-05T11:30:00Z', 'succeeded', now)).toBe('30 min ago (succeeded)');
    expect(formatLastRun('2026-10-05T09:00:00Z', 'failed', now)).toBe('3 h ago (failed)');
    expect(formatLastRun('2026-10-03T12:00:00Z', null, now)).toBe('2 d ago');
  });
});

describe('BUILDS_PER_RUN_OPTIONS', () => {
  it('starts with 0 (paused) and stays within the server cap of 20', () => {
    expect(BUILDS_PER_RUN_OPTIONS[0]).toBe(0);
    expect(Math.max(...BUILDS_PER_RUN_OPTIONS)).toBeLessThanOrEqual(20);
  });
});

describe('PLACE_PER_DAY_OPTIONS', () => {
  it('starts with 0 (paused), is increasing, and stays within the server cap of 1000', () => {
    expect(PLACE_PER_DAY_OPTIONS[0]).toBe(0);
    expect([...PLACE_PER_DAY_OPTIONS].sort((a, b) => a - b)).toEqual(PLACE_PER_DAY_OPTIONS);
    expect(Math.max(...PLACE_PER_DAY_OPTIONS)).toBeLessThanOrEqual(1000);
  });
});
