import { describeRequests, describeRetry, placeIssueInfo, summarizePlaceIssues } from './menuIssues';

describe('placeIssueInfo', () => {
  it('labels each failure, and marks only "needs attention" as stopped', () => {
    expect(placeIssueInfo('needs_attention')).toEqual({ label: 'Needs attention', tone: 'bad', stopped: true });
    expect(placeIssueInfo('no_menu_link')).toEqual({ label: 'No menu link', tone: 'warn', stopped: false });
    expect(placeIssueInfo('unreadable').label).toBe('Page not readable');
    expect(placeIssueInfo('error').label).toBe('Error');
    expect(placeIssueInfo('weird')).toEqual({ label: 'weird', tone: 'warn', stopped: false });
  });
});

describe('describeRetry', () => {
  const now = new Date('2026-10-05T12:00:00Z');
  const at = (hours: number) => new Date(now.getTime() + hours * 3_600_000).toISOString();

  it('says when a failed build will be tried again', () => {
    expect(describeRetry({ status: 'error', next_attempt_at: at(0.1) }, now)).toBe('retries soon');
    expect(describeRetry({ status: 'error', next_attempt_at: at(6) }, now)).toBe('retries in 6 h');
    expect(describeRetry({ status: 'no_menu_link', next_attempt_at: at(72) }, now)).toBe('retries in 3 d');
    expect(describeRetry({ status: 'unreadable', next_attempt_at: at(-5) }, now)).toBe('retries soon');
  });

  it('says nothing for a stopped job or a missing time', () => {
    expect(describeRetry({ status: 'needs_attention', next_attempt_at: at(6) }, now)).toBe('');
    expect(describeRetry({ status: 'error', next_attempt_at: null }, now)).toBe('');
    expect(describeRetry({ status: 'error', next_attempt_at: 'garbage' }, now)).toBe('');
  });
});

describe('summarizePlaceIssues / describeRequests', () => {
  it('counts the stopped ones apart from those still being retried', () => {
    expect(summarizePlaceIssues([{ status: 'needs_attention' }, { status: 'error' }, { status: 'no_menu_link' }])).toEqual({ total: 3, stopped: 1, retrying: 2 });
    expect(summarizePlaceIssues([])).toEqual({ total: 0, stopped: 0, retrying: 0 });
  });

  it('describes how often customers opened the restaurant', () => {
    expect(describeRequests(1)).toBe('Opened by a customer once');
    expect(describeRequests(0)).toBe('Opened by a customer once');
    expect(describeRequests(7)).toBe('Opened by customers 7 times');
  });
});
