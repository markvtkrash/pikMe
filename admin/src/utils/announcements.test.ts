import {
  buildAnnouncementInput, describeAudience, describeStatus, describeVersions, describeWindow, EMPTY_ANNOUNCEMENT_FORM,
  formFromRow, parseLocalDateTime, publishQuestion, AnnouncementForm, AnnouncementRow,
} from './announcements';

const good = (over: Partial<AnnouncementForm> = {}): AnnouncementForm => ({
  ...EMPTY_ANNOUNCEMENT_FORM, audience: 'customer', title: 'Hello', message: 'New feature', ...over,
});

describe('parseLocalDateTime', () => {
  it('reads a local date and time', () => {
    const iso = parseLocalDateTime('2026-10-12 09:30') as string;
    const d = new Date(iso);
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 10, 12, 9, 30]);
  });

  it('reads a date alone as midnight, and blank as not set', () => {
    const d = new Date(parseLocalDateTime('2026-10-12') as string);
    expect([d.getHours(), d.getMinutes()]).toEqual([0, 0]);
    expect(parseLocalDateTime('')).toBeNull();
    expect(parseLocalDateTime('   ')).toBeNull();
  });

  it('rejects things that are not a time', () => {
    for (const bad of ['tomorrow', '12/10/2026', '2026-13-01', '2026-02-31', '2026-10-12 25:00', '2026-10-12 09:61', '2026-10-12 9:30']) {
      expect([bad, parseLocalDateTime(bad)]).toEqual([bad, undefined]);
    }
  });
});

describe('buildAnnouncementInput', () => {
  it('builds the input for a simple announcement that goes live now', () => {
    const r = buildAnnouncementInput(good({ title: '  Hello  ', message: ' New feature ' }));
    expect(r).toEqual({
      ok: true,
      value: {
        audience: 'customer', title: 'Hello', message: 'New feature', kind: 'info', linkLabel: null, linkUrl: null,
        startsAt: null, endsAt: null, minAppVersion: null, maxAppVersion: null,
      },
    });
  });

  it('asks for an audience, a title and a message', () => {
    expect(buildAnnouncementInput(good({ audience: '' }))).toMatchObject({ ok: false, error: expect.stringMatching(/who/i) });
    expect(buildAnnouncementInput(good({ title: '  ' }))).toMatchObject({ ok: false, error: expect.stringMatching(/title/i) });
    expect(buildAnnouncementInput(good({ message: '' }))).toMatchObject({ ok: false, error: expect.stringMatching(/message/i) });
  });

  it('enforces the length limits', () => {
    expect(buildAnnouncementInput(good({ title: 'x'.repeat(81) }))).toMatchObject({ ok: false });
    expect(buildAnnouncementInput(good({ title: 'x'.repeat(80) })).ok).toBe(true);
    expect(buildAnnouncementInput(good({ message: 'x'.repeat(601) }))).toMatchObject({ ok: false });
    expect(buildAnnouncementInput(good({ message: 'x'.repeat(600) })).ok).toBe(true);
  });

  it('needs a label and an https address together', () => {
    expect(buildAnnouncementInput(good({ linkLabel: 'Read' }))).toMatchObject({ ok: false });
    expect(buildAnnouncementInput(good({ linkUrl: 'https://example.com/a' }))).toMatchObject({ ok: false });
    expect(buildAnnouncementInput(good({ linkLabel: 'Read', linkUrl: 'http://example.com/a' }))).toMatchObject({ ok: false });
    expect(buildAnnouncementInput(good({ linkLabel: 'Read', linkUrl: 'javascript:alert(1)' }))).toMatchObject({ ok: false });
    const ok = buildAnnouncementInput(good({ linkLabel: ' Read more ', linkUrl: ' https://example.com/a ' }));
    expect(ok).toMatchObject({ ok: true, value: { linkLabel: 'Read more', linkUrl: 'https://example.com/a' } });
  });

  it('checks the start and end', () => {
    expect(buildAnnouncementInput(good({ startsAt: 'soon' }))).toMatchObject({ ok: false });
    expect(buildAnnouncementInput(good({ endsAt: '2020-01-01 10:00' }))).toMatchObject({ ok: false, error: expect.stringMatching(/after the start/i) });
    expect(buildAnnouncementInput(good({ startsAt: '2030-01-02 10:00', endsAt: '2030-01-01 10:00' }))).toMatchObject({ ok: false });
    const r = buildAnnouncementInput(good({ startsAt: '2030-01-01 10:00', endsAt: '2030-01-02 10:00' }));
    expect(r.ok).toBe(true);
  });

  it('checks the app versions, and keeps them to customers', () => {
    expect(buildAnnouncementInput(good({ minAppVersion: 'v1' }))).toMatchObject({ ok: false });
    expect(buildAnnouncementInput(good({ minAppVersion: '2.0.0', maxAppVersion: '1.0.0' }))).toMatchObject({ ok: false });
    expect(buildAnnouncementInput(good({ minAppVersion: '1.0.0', maxAppVersion: '1.9.9' })).ok).toBe(true);
    expect(buildAnnouncementInput(good({ audience: 'owner', minAppVersion: '1.0.0' }))).toMatchObject({ ok: false });
    expect(buildAnnouncementInput(good({ audience: 'both', minAppVersion: '1.0.0' })).ok).toBe(true);
  });
});

describe('wording', () => {
  it('names audiences and statuses', () => {
    expect(describeAudience('customer')).toBe('Customers');
    expect(describeAudience('owner')).toBe('Owners');
    expect(describeAudience('both')).toBe('Customers and owners');
    expect(describeStatus('live')).toEqual({ label: 'Live', tone: 'good' });
    expect(describeStatus('scheduled').tone).toBe('warn');
    expect(describeStatus('ended').tone).toBe('neutral');
  });

  it('describes the version range and the time window', () => {
    expect(describeVersions({ min_app_version: '1.0.0', max_app_version: '1.2.0' })).toBe('App versions 1.0.0 to 1.2.0');
    expect(describeVersions({ min_app_version: '1.0.0', max_app_version: null })).toBe('App versions 1.0.0 and newer');
    expect(describeVersions({ min_app_version: null, max_app_version: '1.2.0' })).toBe('App versions up to 1.2.0');
    expect(describeVersions({ min_app_version: null, max_app_version: null })).toBe('');
    expect(describeWindow({ starts_at: '2026-10-12T09:30:00Z', ends_at: null, status: 'live' })).toMatch(/^Since /);
    expect(describeWindow({ starts_at: '2026-10-12T09:30:00Z', ends_at: '2026-10-19T09:30:00Z', status: 'ended' })).toMatch(/ to /);
    expect(describeWindow({ starts_at: '2026-10-12T09:30:00Z', ends_at: null, status: 'scheduled' })).toMatch(/^Starts /);
  });

  it('asks before publishing, and says when it goes live', () => {
    expect(publishQuestion({ audience: 'both', startsAt: null })).toMatch(/customers and owners.*right away/);
    const later = new Date(Date.now() + 86_400_000).toISOString();
    expect(publishQuestion({ audience: 'owner', startsAt: later })).toMatch(/owners.*time you set/);
  });
});

describe('formFromRow', () => {
  it('turns a saved announcement back into the form', () => {
    const row: AnnouncementRow = {
      id: 'a1', audience: 'both', title: 'T', message: 'M', kind: 'important', link_label: 'Go', link_url: 'https://example.com/x',
      starts_at: new Date(2026, 9, 12, 9, 30).toISOString(), ends_at: null, min_app_version: '1.0.0', max_app_version: null,
      status: 'live', created_at: '2026-10-01T00:00:00Z',
    };
    expect(formFromRow(row)).toEqual({
      audience: 'both', title: 'T', message: 'M', kind: 'important', linkLabel: 'Go', linkUrl: 'https://example.com/x',
      startsAt: '2026-10-12 09:30', endsAt: '', minAppVersion: '1.0.0', maxAppVersion: '',
    });
  });
});
