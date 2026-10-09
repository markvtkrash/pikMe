import { buildDeleteMessage, describeDeleteCounts, RestaurantDeleteCounts } from './restaurantDelete';

const counts = (over: Partial<RestaurantDeleteCounts> = {}): RestaurantDeleteCounts => ({
  dryRun: true, restaurant: 'Joe\'s Diner', coupons: 0, couponActivations: 0, ownerMenuItems: 0, supportTickets: 0,
  relocationRequests: 0, locationMenuItems: 0, sharedMenuItems: 0, sharedMenuKept: false, savedCopies: 0, ...over,
});

describe('describeDeleteCounts', () => {
  it('lists only what exists, with correct singular and plural', () => {
    expect(describeDeleteCounts(counts())).toEqual([]);
    expect(describeDeleteCounts(counts({ coupons: 1 }))).toEqual(['1 coupon']);
    expect(describeDeleteCounts(counts({ coupons: 3, couponActivations: 1, supportTickets: 2 }))).toEqual([
      '3 coupons (1 customer activation)', '2 support tickets',
    ]);
  });

  it('adds location and shared menu rows together and mentions customers saved copies', () => {
    const lines = describeDeleteCounts(counts({ locationMenuItems: 4, sharedMenuItems: 6, savedCopies: 2 }));
    expect(lines).toEqual(["10 menu items (2 saved copies in customers' lists)"]);
  });
});

describe('buildDeleteMessage', () => {
  it('names the restaurant, lists what goes and says the owner login stays', () => {
    const msg = buildDeleteMessage(counts({ coupons: 2, ownerMenuItems: 1 }));
    expect(msg).toContain("Joe's Diner will be deleted");
    expect(msg).toContain('• 2 coupons');
    expect(msg).toContain('• 1 owner menu entry');
    expect(msg).toContain('The owner login is kept.');
    expect(msg).toContain('cannot be undone');
    expect(msg).not.toContain('shared menu');
  });

  it('says when the shared menu is kept, and when there is nothing of its own', () => {
    const msg = buildDeleteMessage(counts({ sharedMenuKept: true }));
    expect(msg).toContain('It has no coupons or menu items of its own.');
    expect(msg).toContain('shared menu for this name is kept');
  });
});
