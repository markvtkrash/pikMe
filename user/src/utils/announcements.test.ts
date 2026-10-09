import { addSeenId, nextAnnouncement, parseAnnouncements, safeLinkUrl } from './announcements';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'a1', title: 'Hello', message: 'New feature', kind: 'info', link_label: null, link_url: null, ...over,
});

describe('safeLinkUrl', () => {
  it('allows only https addresses', () => {
    expect(safeLinkUrl(' https://example.com/news ')).toBe('https://example.com/news');
    for (const bad of ['http://example.com', 'javascript:alert(1)', 'ftp://x.example.com', 'https://', 'not a link', '', null, undefined, 5]) {
      expect([bad, safeLinkUrl(bad)]).toEqual([bad, null]);
    }
    expect(safeLinkUrl('https://a b.com')).toBeNull();
  });
});

describe('parseAnnouncements', () => {
  it('reads valid announcements', () => {
    expect(parseAnnouncements([row({ link_label: 'Read more', link_url: 'https://example.com/n' })])).toEqual([
      { id: 'a1', title: 'Hello', message: 'New feature', kind: 'info', linkLabel: 'Read more', linkUrl: 'https://example.com/n' },
    ]);
  });

  it('returns nothing for anything that is not a list', () => {
    for (const raw of [null, undefined, {}, 'x', 5]) expect(parseAnnouncements(raw)).toEqual([]);
  });

  it('drops malformed ones and keeps the rest', () => {
    const out = parseAnnouncements([null, 'x', row({ id: '' }), row({ id: 'b', title: '  ' }), row({ id: 'c', message: '' }), row({ id: 'ok' })]);
    expect(out.map((a) => a.id)).toEqual(['ok']);
  });

  it('drops a link that is not https or has no label, but keeps the announcement', () => {
    const out = parseAnnouncements([
      row({ id: 'x', link_label: 'Go', link_url: 'http://insecure.example.com' }),
      row({ id: 'y', link_label: '', link_url: 'https://example.com/a' }),
    ]);
    expect(out.map((a) => [a.id, a.linkLabel, a.linkUrl])).toEqual([['x', null, null], ['y', null, null]]);
  });

  it('puts important first, and keeps at most three', () => {
    const out = parseAnnouncements([row({ id: '1' }), row({ id: '2' }), row({ id: '3', kind: 'important' }), row({ id: '4' })]);
    expect(out.map((a) => a.id)).toEqual(['3', '1', '2']);
  });

  it('treats an unknown kind as info', () => {
    expect(parseAnnouncements([row({ kind: 'weird' })])[0].kind).toBe('info');
  });
});

describe('nextAnnouncement and addSeenId', () => {
  const list = parseAnnouncements([row({ id: 'a' }), row({ id: 'b' })]);

  it('gives the first one not seen yet', () => {
    expect(nextAnnouncement(list, [])?.id).toBe('a');
    expect(nextAnnouncement(list, ['a'])?.id).toBe('b');
    expect(nextAnnouncement(list, ['a', 'b'])).toBeNull();
    expect(nextAnnouncement([], [])).toBeNull();
  });

  it('remembers an id once, and only the newest 200', () => {
    expect(addSeenId(['a'], 'a')).toEqual(['a']);
    expect(addSeenId(['a'], 'b')).toEqual(['a', 'b']);
    const many = Array.from({ length: 200 }, (_, i) => `id${i}`);
    const next = addSeenId(many, 'new');
    expect(next).toHaveLength(200);
    expect(next[0]).toBe('id1');
    expect(next[199]).toBe('new');
  });
});
