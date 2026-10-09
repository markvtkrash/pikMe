import { BUILD_LOG_HOURS, canManageFromBuild, describeBuildOutcome, manageChainParams, summarizeBuildLog } from './chainMenuSources';

describe('canManageFromBuild', () => {
  it('offers Manage for every failed franchise build', () => {
    for (const outcome of ['no_menu_link', 'unreadable', 'error', 'no_result', 'needs_attention']) {
      expect(canManageFromBuild({ outcome, kind: 'chain', chain_id: 'c1' })).toBe(true);
    }
    // rows from before migration 105 have no kind: they are franchise builds
    expect(canManageFromBuild({ outcome: 'error', chain_id: 'c1' })).toBe(true);
  });

  it('does not offer it for built or running builds, independents, or a missing chain', () => {
    expect(canManageFromBuild({ outcome: 'ok', kind: 'chain', chain_id: 'c1' })).toBe(false);
    expect(canManageFromBuild({ outcome: 'running', kind: 'chain', chain_id: 'c1' })).toBe(false);
    expect(canManageFromBuild({ outcome: 'error', kind: 'place', chain_id: 'c1' })).toBe(false);
    expect(canManageFromBuild({ outcome: 'error', kind: 'chain', chain_id: '' })).toBe(false);
  });

  it('offers the menu editor for a failed independent read, when it has a place', () => {
    for (const outcome of ['error', 'no_items', 'needs_attention', 'no_result']) {
      expect(canManageFromBuild({ outcome, kind: 'place', chain_id: '', place_id: 'ChIJ_abc1234567' })).toBe(true);
    }
    expect(canManageFromBuild({ outcome: 'ok', kind: 'place', chain_id: '', place_id: 'ChIJ_abc1234567' })).toBe(false);
    expect(canManageFromBuild({ outcome: 'waiting', kind: 'place', chain_id: '', place_id: 'ChIJ_abc1234567' })).toBe(false);
    expect(canManageFromBuild({ outcome: 'running', kind: 'place', chain_id: '', place_id: 'ChIJ_abc1234567' })).toBe(false);
    expect(canManageFromBuild({ outcome: 'no_items', kind: 'place', chain_id: '', place_id: null })).toBe(false);
  });

  it('labels a read that found no dishes and counts it as failed', () => {
    expect(describeBuildOutcome('no_items')).toEqual({ label: 'No dishes found', tone: 'warn' });
    expect(summarizeBuildLog([{ outcome: 'no_items' }, { outcome: 'ok' }]).failed).toBe(1);
  });

  it('opens Franchise Menu Management on that chain', () => {
    expect(manageChainParams('c1')).toEqual({ manage: 'c1' });
  });
});

describe('describeBuildOutcome', () => {
  it('labels each outcome with a tone', () => {
    expect(describeBuildOutcome('ok')).toEqual({ label: 'Built', tone: 'good' });
    expect(describeBuildOutcome('running')).toEqual({ label: 'Running', tone: 'neutral' });
    for (const o of ['no_menu_link', 'unreadable', 'error']) expect(describeBuildOutcome(o).tone).toBe('bad');
    expect(describeBuildOutcome('no_result')).toEqual({ label: 'No result', tone: 'warn' });
    expect(describeBuildOutcome('needs_attention')).toEqual({ label: 'Needs attention', tone: 'bad' });
    expect(describeBuildOutcome('waiting')).toEqual({ label: 'Waiting', tone: 'neutral' });
    expect(describeBuildOutcome('weird')).toEqual({ label: 'weird', tone: 'neutral' });
  });
});

describe('summarizeBuildLog', () => {
  it('counts started, built, failed and running', () => {
    const rows = ['ok', 'ok', 'error', 'unreadable', 'no_menu_link', 'no_result', 'needs_attention', 'running'].map((outcome) => ({ outcome }));
    expect(summarizeBuildLog(rows)).toEqual({ total: 8, built: 2, failed: 5, running: 1 });
    expect(summarizeBuildLog([])).toEqual({ total: 0, built: 0, failed: 0, running: 0 });
  });
});

describe('BUILD_LOG_HOURS', () => {
  it('offers a few windows, shortest first, within the server cap of 720 hours', () => {
    expect([...BUILD_LOG_HOURS].sort((a, b) => a - b)).toEqual(BUILD_LOG_HOURS);
    expect(Math.max(...BUILD_LOG_HOURS)).toBeLessThanOrEqual(720);
  });
});
