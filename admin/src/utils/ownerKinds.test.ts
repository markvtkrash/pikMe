import { countByKind, matchesOwnerKind } from './ownerKinds';

const franchises = new Set(["McDonald's", 'Taco Bell']);

describe('matchesOwnerKind', () => {
  it('shows everything for All, including an owner with no restaurant', () => {
    for (const n of ["McDonald's", 'Cactus Grill', null, undefined, '']) expect(matchesOwnerKind(n as any, franchises, 'all')).toBe(true);
  });

  it('splits franchise and independent by name', () => {
    expect(matchesOwnerKind("McDonald's", franchises, 'franchise')).toBe(true);
    expect(matchesOwnerKind("McDonald's", franchises, 'independent')).toBe(false);
    expect(matchesOwnerKind('Cactus Grill', franchises, 'franchise')).toBe(false);
    expect(matchesOwnerKind(' Cactus Grill ', franchises, 'independent')).toBe(true);
    expect(matchesOwnerKind(' Taco Bell ', franchises, 'franchise')).toBe(true);
  });

  it('leaves an owner with no restaurant out of both kinds', () => {
    for (const n of [null, undefined, '', '  ']) {
      expect(matchesOwnerKind(n as any, franchises, 'franchise')).toBe(false);
      expect(matchesOwnerKind(n as any, franchises, 'independent')).toBe(false);
    }
  });

  it('treats everything as independent when no franchise names are known', () => {
    expect(matchesOwnerKind("McDonald's", new Set(), 'independent')).toBe(true);
  });
});

describe('countByKind', () => {
  it('counts each kind', () => {
    const rows = [{ restaurant_name: "McDonald's" }, { restaurant_name: 'Cactus Grill' }, { restaurant_name: 'Joes' }, { restaurant_name: null }];
    expect(countByKind(rows, franchises)).toEqual({ all: 4, franchise: 1, independent: 2 });
  });
});
