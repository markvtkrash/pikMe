import { buildReplaceMessage, describeSuggestionTrust, isReplacement, shortLink } from './chainMenuSources';

describe('isReplacement / buildReplaceMessage', () => {
  it('is a replacement only when the chain already has a built-in page', () => {
    expect(isReplacement({ current_menu_url: 'https://old.com/menu' })).toBe(true);
    expect(isReplacement({ current_menu_url: null })).toBe(false);
    expect(isReplacement({})).toBe(false);
  });

  it('shows both links and says the old one is not kept', () => {
    const msg = buildReplaceMessage({
      chain_name: 'Taco Bell', suggested_link: 'https://new.com/menu', current_menu_url: 'https://old.com/menu',
    });
    expect(msg).toContain('Taco Bell already has a built-in menu page');
    expect(msg).toContain('Current:\nhttps://old.com/menu');
    expect(msg).toContain('Replace it with:\nhttps://new.com/menu');
    expect(msg).toContain('not kept');
  });
});

describe('describeSuggestionTrust', () => {
  it('says when the link is on the same site as the chain', () => {
    expect(describeSuggestionTrust({ matches_chain_website: true, owner_count: 1 })).toEqual({
      label: 'Same site as the chain · 1 owner', tone: 'good',
    });
  });

  it('warns when it is a different site, with the number of owners', () => {
    expect(describeSuggestionTrust({ matches_chain_website: false, owner_count: 3 })).toEqual({
      label: 'Different site from the chain · 3 owners', tone: 'warn',
    });
  });

  it('is neutral when the chain website is not known', () => {
    expect(describeSuggestionTrust({ matches_chain_website: null, owner_count: 2 }).tone).toBe('neutral');
  });
});

describe('shortLink', () => {
  it('drops the scheme and www', () => {
    expect(shortLink('https://www.tacobell.com/food')).toBe('tacobell.com/food');
    expect(shortLink('http://x.com/menu')).toBe('x.com/menu');
  });

  it('cuts a very long link', () => {
    const out = shortLink(`https://x.com/${'a'.repeat(100)}`, 20);
    expect(out).toHaveLength(20);
    expect(out.endsWith('…')).toBe(true);
  });
});
