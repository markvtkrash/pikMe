import { describePullResult } from './chainMenuSources';

describe('describePullResult', () => {
  it('reports a built menu with its item count as a success', () => {
    const r = describePullResult({ status: 'ok', itemCount: 30, chain: 'Taco Bell' });
    expect(r.success).toBe(true);
    expect(r.title).toBe('Menu built');
    expect(r.message).toBe('30 items are now shown for Taco Bell.');
  });

  it('does not claim success for anything else', () => {
    for (const status of ['in_progress', 'no_menu_link', 'unreadable', 'no_place_id', 'error', 'not_a_chain', 'weird']) {
      expect(describePullResult({ status, chain: 'X' }).success).toBe(false);
    }
  });

  it('tells the admin what to do next for each failure', () => {
    expect(describePullResult({ status: 'no_menu_link', chain: 'Dunkin' }).message).toMatch(/Enter its menu link by hand/);
    expect(describePullResult({ status: 'unreadable', chain: 'Dunkin' }).message).toMatch(/different link/);
    expect(describePullResult({ status: 'in_progress', chain: 'Dunkin' }).message).toMatch(/already in progress/);
    expect(describePullResult({ status: 'error', chain: 'Dunkin' }).message).toMatch(/retried automatically/);
  });

  it('uses the server message when there is no place to look up', () => {
    expect(describePullResult({ status: 'no_place_id', message: 'Custom reason' }).message).toBe('Custom reason');
    expect(describePullResult({ status: 'no_place_id', chain: 'Dunkin' }).message).toMatch(/No store of Dunkin/);
  });

  it('copes with missing fields and an empty result', () => {
    expect(describePullResult({ status: 'ok' }).message).toBe('0 items are now shown for this chain.');
    expect(describePullResult(null).title).toBe('Finished');
    expect(describePullResult(undefined).message).toMatch(/answered "nothing"/);
    expect(describePullResult({}).success).toBe(false);
  });
});
