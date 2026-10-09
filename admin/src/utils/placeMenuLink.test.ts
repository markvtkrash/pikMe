import {
  adminLinkOnHold, checkMenuLinkInput, describeAdminLinkResult, describeLinkSource, describeLinkStatus, toPlaceMenuLink,
} from './placeMenuLink';

describe('toPlaceMenuLink', () => {
  it('maps the first row', () => {
    expect(toPlaceMenuLink([{ link: 'https://a.example.com/menu', source: 'google', status: 'no_items', detail: 'none', finished_at: '2026-10-01T00:00:00Z' }]))
      .toEqual({
        link: 'https://a.example.com/menu', source: 'google', status: 'no_items', detail: 'none', finished_at: '2026-10-01T00:00:00Z',
        requested_at: null, admin_link: null, admin_link_ok: null,
      });
  });

  it('fills missing fields and is null when there is no usable link', () => {
    expect(toPlaceMenuLink([{ link: 'https://a.example.com' }])).toMatchObject({ source: 'owner', status: null, detail: null });
    for (const none of [[], null, undefined, [{ link: '' }], [{ link: '   ' }], [{}]]) {
      expect(toPlaceMenuLink(none as any)).toBeNull();
    }
  });
});

describe('checkMenuLinkInput', () => {
  it('accepts a web address and trims it', () => {
    expect(checkMenuLinkInput('  https://www.turath-coffee.com/menu ')).toBe('https://www.turath-coffee.com/menu');
    expect(checkMenuLinkInput('http://pizza.example.com')).toBe('http://pizza.example.com');
  });

  it('treats blank as "remove my link"', () => {
    expect(checkMenuLinkInput('')).toBe('');
    expect(checkMenuLinkInput('   ')).toBe('');
  });

  it('refuses anything that is not a full web address', () => {
    for (const bad of ['turath-coffee.com/menu', 'ftp://x.example.com', 'javascript:alert(1)', 'https://a b.com', 'https://localhost', 'https://', 'not a link']) {
      expect([bad, checkMenuLinkInput(bad)]).toEqual([bad, null]);
    }
    expect(checkMenuLinkInput('https://x.example.com/' + 'a'.repeat(2100))).toBeNull();
  });
});

describe('wording', () => {
  it('names the source', () => {
    expect(describeLinkSource('admin')).toMatch(/admin/);
    expect(describeLinkSource('owner')).toMatch(/owner/);
    expect(describeLinkSource('google')).toMatch(/Google/);
    expect(describeLinkSource(null)).toBe('unknown source');
  });

  it('describes the last read, blank when never read', () => {
    expect(describeLinkStatus('no_items')).toMatch(/no dishes/i);
    expect(describeLinkStatus('pending')).toMatch(/waiting/i);
    expect(describeLinkStatus(null)).toBe('');
    expect(describeLinkStatus('whatever')).toBe('');
  });
});

describe('the admin link kept beside the owner link', () => {
  it('maps the admin link and whether it worked', () => {
    const row = toPlaceMenuLink([{ link: 'https://o.example.com', source: 'owner', admin_link: 'https://a.example.com', admin_link_ok: true, requested_at: '2026-10-02T00:00:00Z' }]);
    expect(row).toMatchObject({ admin_link: 'https://a.example.com', admin_link_ok: true, requested_at: '2026-10-02T00:00:00Z' });
    expect(toPlaceMenuLink([{ link: 'https://o.example.com', admin_link: '  ', admin_link_ok: 'yes' }])).toMatchObject({ admin_link: null, admin_link_ok: null });
  });

  it('says how the admin link did', () => {
    expect(describeAdminLinkResult(true)).toMatch(/worked/);
    expect(describeAdminLinkResult(false)).toMatch(/didn't work/);
    expect(describeAdminLinkResult(null)).toBe('not read yet');
  });

  it('is on hold only when the owner link is in force and the admin has a different one', () => {
    expect(adminLinkOnHold({ source: 'owner', link: 'https://o', admin_link: 'https://a' })).toBe(true);
    expect(adminLinkOnHold({ source: 'owner', link: 'https://o', admin_link: 'https://o' })).toBe(false);
    expect(adminLinkOnHold({ source: 'owner', link: 'https://o', admin_link: null })).toBe(false);
    expect(adminLinkOnHold({ source: 'admin', link: 'https://a', admin_link: 'https://a' })).toBe(false);
  });
});
