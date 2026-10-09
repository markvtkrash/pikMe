import { MAX_ALIASES, parseAliases, validateNewFranchise } from './newFranchise';

const ok = { name: 'Taco Bell', category: '', aliases: '', menuUrl: '' };

describe('parseAliases', () => {
  it('splits on commas and new lines, trims, and drops blanks', () => {
    expect(parseAliases('The Cheesecake Factory,  Cheesecake Factory Bakery\n, ,')).toEqual([
      'The Cheesecake Factory', 'Cheesecake Factory Bakery',
    ]);
    expect(parseAliases('')).toEqual([]);
    expect(parseAliases('   ')).toEqual([]);
  });

  it('removes repeats, ignoring case, keeping the first spelling', () => {
    expect(parseAliases('Subway, subway, SUBWAY Sandwiches')).toEqual(['Subway', 'SUBWAY Sandwiches']);
  });
});

describe('validateNewFranchise', () => {
  it('accepts a bare name and a fully filled form', () => {
    expect(validateNewFranchise(ok)).toBeNull();
    expect(validateNewFranchise({
      name: 'Jinkies Pizza', category: 'Pizza', aliases: 'Jinkies, Jinkies Pizzeria', menuUrl: 'https://jinkies.com/menu',
    })).toBeNull();
  });

  it('requires a name with letters or numbers', () => {
    expect(validateNewFranchise({ ...ok, name: '   ' })).toMatch(/Enter the franchise name/);
    expect(validateNewFranchise({ ...ok, name: '#!?' })).toMatch(/letters or numbers/);
    expect(validateNewFranchise({ ...ok, name: '7 Brew' })).toBeNull();
  });

  it('rejects a too-long name, category or alias and too many aliases', () => {
    expect(validateNewFranchise({ ...ok, name: 'a'.repeat(121) })).toMatch(/name is too long/);
    expect(validateNewFranchise({ ...ok, category: 'c'.repeat(61) })).toMatch(/category is too long/);
    expect(validateNewFranchise({ ...ok, aliases: 'a'.repeat(121) })).toMatch(/alias is too long/);
    const many = Array.from({ length: MAX_ALIASES + 1 }, (_, i) => `alias${i}`).join(',');
    expect(validateNewFranchise({ ...ok, aliases: many })).toMatch(/Too many aliases/);
  });

  it('checks the optional menu page like any other menu address', () => {
    expect(validateNewFranchise({ ...ok, menuUrl: 'tacobell.com/menu' })).toMatch(/web address/);
    expect(validateNewFranchise({ ...ok, menuUrl: 'https://x.com/a b' })).toMatch(/spaces/);
  });
});
