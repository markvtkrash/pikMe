import { filterUsers, FilterableUser } from './userFilter';

const owner: FilterableUser = {
  email: 'joe@diner.com',
  role: 'owner',
  business_name: 'Joe Diner LLC',
  restaurant_name: "Joe's Diner",
  restaurant_address: '123 Main St, Austin, TX',
};
const ownerNoRestaurant: FilterableUser = {
  email: 'new@owner.com',
  role: 'owner',
  business_name: 'Brand New Co',
  restaurant_name: null,
  restaurant_address: null,
};
const customer: FilterableUser = { email: 'sam@mail.com', role: 'customer', business_name: null };
const admin: FilterableUser = { email: 'root@pikme.com', role: 'admin', business_name: null };
const everyone = [owner, ownerNoRestaurant, customer, admin];

describe('filterUsers — tabs', () => {
  it('"all" returns everyone', () => {
    expect(filterUsers(everyone, 'all', '')).toEqual(everyone);
  });

  it.each([
    ['owner', [owner, ownerNoRestaurant]],
    ['customer', [customer]],
    ['admin', [admin]],
  ] as const)('"%s" returns only that role', (tab, expected) => {
    expect(filterUsers(everyone, tab, '')).toEqual(expected);
  });
});

describe('filterUsers — search', () => {
  it('matches the email, case-insensitively', () => {
    expect(filterUsers(everyone, 'all', 'JOE@DINER')).toEqual([owner]);
  });

  it('matches the business name', () => {
    expect(filterUsers(everyone, 'all', 'brand new')).toEqual([ownerNoRestaurant]);
  });

  it('matches the restaurant name', () => {
    expect(filterUsers(everyone, 'all', "joe's diner")).toEqual([owner]);
  });

  it('matches the restaurant address', () => {
    expect(filterUsers(everyone, 'all', 'main st')).toEqual([owner]);
    expect(filterUsers(everyone, 'all', 'austin')).toEqual([owner]);
  });

  it('trims the query and treats a blank query as no filter', () => {
    expect(filterUsers(everyone, 'all', '  austin  ')).toEqual([owner]);
    expect(filterUsers(everyone, 'all', '   ')).toEqual(everyone);
  });

  it('returns nothing when no field matches', () => {
    expect(filterUsers(everyone, 'all', 'zzzz')).toEqual([]);
  });

  it('combines the tab and the search', () => {
    expect(filterUsers(everyone, 'customer', 'austin')).toEqual([]);
    expect(filterUsers(everyone, 'owner', 'austin')).toEqual([owner]);
  });

  it('copes with users that have no restaurant fields at all (older RPC shape)', () => {
    expect(filterUsers([customer, admin], 'all', 'sam')).toEqual([customer]);
  });

  it('does not mutate the input', () => {
    const input = [...everyone];
    filterUsers(input, 'owner', 'joe');
    expect(input).toEqual(everyone);
  });
});
