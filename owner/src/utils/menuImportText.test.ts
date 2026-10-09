import { ONLINE_LINK_TITLE, linkHelpMessage, onlineLinkHelp, onlineLinkSavedMessage } from './menuImportText';

describe('onlineLinkHelp', () => {
  it('is titled like the section', () => {
    expect(ONLINE_LINK_TITLE).toBe('Import Menu from Online Link');
    expect(onlineLinkHelp(false).title).toBe('Import Menu from Online Link');
    expect(onlineLinkHelp(true).title).toBe('Import Menu from Online Link');
  });

  it('tells an independent owner it will not work if the online menu is an image, and what to use instead', () => {
    const { message } = onlineLinkHelp(false);
    expect(message).toMatch(/will NOT work if your online menu is a picture/);
    expect(message).toContain('"Import Menu from Photo"');
    expect(message).toContain('"Import Menu" again');
  });

  it('gives a chain owner the chain explanation and does not point them at photo import', () => {
    const { message } = onlineLinkHelp(true);
    expect(message).toMatch(/chain/i);
    expect(message).toMatch(/review/i);
    expect(message).not.toContain('Import Menu from Photo');
  });
});

describe('onlineLinkSavedMessage', () => {
  it('says the link was removed when it was cleared', () => {
    expect(onlineLinkSavedMessage(false, false)).toBe('Your menu page was removed.');
    expect(onlineLinkSavedMessage(false, true)).toBe('Your menu page was removed.');
  });

  it('reminds an independent owner that a picture menu needs the photo import', () => {
    const m = onlineLinkSavedMessage(true, false);
    expect(m).toContain('usually within a day');
    expect(m).toContain('picture');
    expect(m).toContain('"Import Menu from Photo"');
  });

  it('tells a chain owner it goes to the team for review', () => {
    const m = onlineLinkSavedMessage(true, true);
    expect(m).toMatch(/team will review/);
    expect(m).not.toContain('Import Menu from Photo');
  });
});

describe('the bell alert wording', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { MENU_IMPORT_ALERT_TITLE, menuImportAlertMessage, shortLink } = require('./menuImportText');

  it('has a clear title', () => {
    expect(MENU_IMPORT_ALERT_TITLE).toBe('Menu import was not successful');
  });

  it('shortLink drops https://, a trailing slash, and shortens a long address', () => {
    expect(shortLink('https://www.turath-coffee.com/menu/')).toBe('www.turath-coffee.com/menu');
    expect(shortLink('http://example.com')).toBe('example.com');
    const long = shortLink('https://example.com/' + 'a'.repeat(100));
    expect(long.length).toBe(48);
    expect(long.endsWith('…')).toBe(true);
    expect(shortLink(undefined as any)).toBe('');
  });

  it('an empty read says the import was not successful with that link and suggests the photo import', () => {
    const m = menuImportAlertMessage('no_items', 'https://www.turath-coffee.com/menu');
    expect(m).toContain('could not import any menu items');
    expect(m).toContain('www.turath-coffee.com/menu');
    expect(m).toContain('picture');
    expect(m).toContain('"Import Menu from Photo"');
  });

  it('an unreadable link says so and suggests the photo import', () => {
    const m = menuImportAlertMessage('needs_attention', 'https://x.example.com/m');
    expect(m).toContain('could not read the menu link');
    expect(m).toContain('after several tries');
    expect(m).toContain('"Import Menu from Photo"');
  });
});

describe('linkHelpMessage', () => {
  it('offers the suggested link when there is one, without saying who set it', () => {
    const m = linkHelpMessage('https://good.example.com/menu');
    expect(m.suggestion).toBe('https://good.example.com/menu');
    expect(m.text).toMatch(/check the address/i);
    expect(m.text).toMatch(/Our team suggests/);
    expect(m.text).not.toMatch(/admin/i);
  });

  it('points to a working link without claiming the owner link failed, when only that is known', () => {
    const m = linkHelpMessage('https://good.example.com/menu', false);
    expect(m.suggestion).toBe('https://good.example.com/menu');
    expect(m.text).toMatch(/working menu link/);
    expect(m.text).toMatch(/saved link is different/);
    expect(m.text).not.toMatch(/couldn't find dishes/);
    expect(m.text).not.toMatch(/admin/i);
  });

  it('only asks the owner to check their link when there is nothing to suggest, and points to the photo import', () => {
    const m = linkHelpMessage(null);
    expect(m.suggestion).toBeNull();
    expect(m.text).toMatch(/check that the address is right/i);
    expect(m.text).toContain('Import Menu from Photo');
  });
});
