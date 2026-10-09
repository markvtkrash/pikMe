import {
  buildCandidateList, cleanMenuLink, guessMenuUrls,
} from '../../../supabase/functions/get-chain-menu/chainMenuUtils';

describe('guessMenuUrls', () => {
  it('suggests the common menu paths on the store\'s own website, in order', () => {
    expect(guessMenuUrls('https://whataburger.com/')).toEqual([
      'https://whataburger.com/menu', 'https://whataburger.com/menus', 'https://whataburger.com/our-menu',
    ]);
  });

  it('uses only the site\'s address, ignoring the page and tracking parameters', () => {
    expect(guessMenuUrls('https://www.panerabread.com/en-us/cafe/locations/ks/overland-park?utm_source=google')[0])
      .toBe('https://www.panerabread.com/menu');
  });

  it('moves a store-locator subdomain to the main site', () => {
    expect(guessMenuUrls('https://locations.tacobell.com/ks/olathe/15109.html')[0]).toBe('https://www.tacobell.com/menu');
    expect(guessMenuUrls('https://stores.example.com/x')[0]).toBe('https://www.example.com/menu');
  });

  it('keeps http, and other subdomains as they are', () => {
    expect(guessMenuUrls('http://eat.example.com/')[0]).toBe('http://eat.example.com/menu');
  });

  it('gives nothing for social, delivery and listing sites', () => {
    for (const site of [
      'https://www.facebook.com/7brew', 'https://instagram.com/x', 'https://www.yelp.com/biz/x',
      'https://www.ubereats.com/store/x', 'https://order.doordash.com/x', 'https://linktr.ee/x',
    ]) expect(guessMenuUrls(site)).toEqual([]);
  });

  it('gives nothing for non-web addresses and bad input', () => {
    for (const bad of ['ftp://x.com/', 'javascript:alert(1)', 'not a url', '', undefined, null, 42]) {
      expect(guessMenuUrls(bad)).toEqual([]);
    }
  });

  it('honours the maximum', () => {
    expect(guessMenuUrls('https://example.com', 1)).toEqual(['https://example.com/menu']);
    expect(guessMenuUrls('https://example.com', 0)).toEqual([]);
  });
});

describe('buildCandidateList', () => {
  const fresh = cleanMenuLink('https://www.tacobell.com/food?store=034416')!;
  const website = cleanMenuLink('https://whataburger.com/')!;
  const locator = cleanMenuLink('https://locations.whataburger.com/ks/overland-park/8420-w-135th-st.html')!;
  const menuSite = cleanMenuLink('https://www.wingstop.com/location/x/menu')!;
  const urls = (list: { url: string }[]) => list.map((c) => c.url);

  it('uses the link SerpApi returned and nothing else', () => {
    const list = buildCandidateList({ cleaned: fresh, storedLink: 'https://old/menu', directoryLink: 'https://dir/menu', website });
    expect(list).toEqual([{ url: 'https://www.tacobell.com/food?store=034416', guess: false }]);
  });

  it('then the stored link (a manual link lands here), with its store parameter', () => {
    const list = buildCandidateList({
      cleaned: null, storedLink: 'https://www.tacobell.com/food', storedRef: 'store=034416', directoryLink: 'https://dir/menu', website,
    });
    expect(list).toEqual([{ url: 'https://www.tacobell.com/food?store=034416', guess: false }]);
  });

  it('otherwise tries the built-in menu page first, then guesses on the website', () => {
    const list = buildCandidateList({ cleaned: null, directoryLink: 'https://whataburger.com/menu?utm_source=x', website });
    expect(urls(list)).toEqual([
      'https://whataburger.com/menu',
      // the guessed /menu is the same address, so it is not repeated
      'https://whataburger.com/menus',
      'https://whataburger.com/our-menu',
    ]);
    expect(list[0].guess).toBe(false);
    expect(list.slice(1).every((c) => c.guess)).toBe(true);
  });

  it('with no built-in page, tries the website only if it looks like a menu page, then guesses', () => {
    const list = buildCandidateList({ cleaned: null, website: menuSite });
    expect(list[0]).toEqual({ url: 'https://www.wingstop.com/location/x/menu', guess: false });
    expect(list.slice(1).every((c) => c.guess)).toBe(true);
  });

  it('never reads a store-locator page as a menu, but guesses on the chain\'s main site', () => {
    const list = buildCandidateList({ cleaned: null, website: locator });
    expect(list.some((c) => c.url.includes('locations.'))).toBe(false);
    expect(list[0]).toEqual({ url: 'https://www.whataburger.com/menu', guess: true });
  });

  it('marks only guessed addresses as guesses', () => {
    const list = buildCandidateList({ cleaned: null, directoryLink: 'https://dir.example.com/menu', website });
    expect(list[0].guess).toBe(false);
    expect(list.filter((c) => c.guess)).toHaveLength(3);
  });

  it('is empty when there is nothing to try', () => {
    expect(buildCandidateList({ cleaned: null, website: null })).toEqual([]);
    expect(buildCandidateList({ cleaned: null, storedLink: '', directoryLink: '', website: null })).toEqual([]);
  });

  it('ignores a built-in value that is not a web address', () => {
    expect(buildCandidateList({ cleaned: null, directoryLink: 'not a url', website: null })).toEqual([]);
  });
});
