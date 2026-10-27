import {
  BannerOrder, couponScopeNote, couponTitle, totalAfterDiscount, isActiveOrder, isPlacedOrder, summarizeActiveOrders,
  EMPTY_CART, SLOT_MINUTES, canCancel, cartCount, cartSubtotalCents, cartToOrderItems, formatCents, isFinal, newIdempotencyKey, pickupSlots,
  quantityOf, reconcileCart, refundNote, secondsSinceLocalMidnight, setQuantity, statusLabel, toOrderableDishes, Cart, Dish,
} from './orders';
import type { MenuItem } from '../types';

const nutrition = { calories: 0, totalFat_g: 0, saturatedFat_g: 0, sodium_mg: 0, totalCarbs_g: 0, dietaryFiber_g: 0, sugars_g: 0, protein_g: 0 };
const item = (over: Partial<MenuItem>): MenuItem => ({ itemId: 'i', restaurantName: 'R', name: 'Dish', isVerified: true, nutrition, priceCents: 1000, ...over });

describe('formatCents', () => {
  it.each([[0, '$0.00'], [5, '$0.05'], [1250, '$12.50'], [100000, '$1,000.00'], [-250, '-$2.50']])('%i is %j', (cents, text) => {
    expect(formatCents(cents)).toBe(text);
  });
  it('treats a non-number as zero', () => {
    expect(formatCents(NaN)).toBe('$0.00');
  });
});

describe('toOrderableDishes', () => {
  it('keeps confirmed dishes that have a price, sorted by name', () => {
    const dishes = toOrderableDishes([
      item({ itemId: 'b', name: 'Fries', priceCents: 500 }),
      item({ itemId: 'a', name: 'Burger', priceCents: 1250 }),
      item({ itemId: 'c', name: 'Guess', isVerified: false }),
      item({ itemId: 'd', name: 'Unpriced', priceCents: null }),
      item({ itemId: 'e', name: 'Free', priceCents: 0 }),
      item({ itemId: 'f', name: 'No price field', priceCents: undefined }),
    ]);
    expect(dishes).toEqual([
      { itemId: 'a', name: 'Burger', priceCents: 1250 },
      { itemId: 'b', name: 'Fries', priceCents: 500 },
    ]);
  });
});

const place = { placeId: 'P1', restaurantName: 'Diner' };
const burger: Dish = { itemId: 'a', name: 'Burger', priceCents: 1250 };
const fries: Dish = { itemId: 'b', name: 'Fries', priceCents: 500 };

describe('the cart', () => {
  it('starts empty', () => {
    expect(cartCount(EMPTY_CART)).toBe(0);
    expect(cartSubtotalCents(EMPTY_CART)).toBe(0);
    expect(quantityOf(EMPTY_CART, 'a')).toBe(0);
  });

  it('adds dishes, changes a quantity, and adds up', () => {
    let cart: Cart = EMPTY_CART;
    cart = setQuantity(cart, place, burger, 2).cart;
    cart = setQuantity(cart, place, fries, 1).cart;
    expect(cart.placeId).toBe('P1');
    expect(cart.restaurantName).toBe('Diner');
    expect(cartCount(cart)).toBe(3);
    expect(cartSubtotalCents(cart)).toBe(3000);
    cart = setQuantity(cart, place, burger, 3).cart;
    expect(quantityOf(cart, 'a')).toBe(3);
    expect(cartSubtotalCents(cart)).toBe(4250);
    expect(cart.lines.map((l) => l.itemId)).toEqual(['a', 'b']);   // order of first adding is kept
  });

  it('removes a dish at zero, and empties the cart when the last one goes', () => {
    let cart = setQuantity(EMPTY_CART, place, burger, 1).cart;
    cart = setQuantity(cart, place, fries, 1).cart;
    cart = setQuantity(cart, place, burger, 0).cart;
    expect(cart.lines.map((l) => l.itemId)).toEqual(['b']);
    cart = setQuantity(cart, place, fries, 0).cart;
    expect(cart).toEqual(EMPTY_CART);
  });

  it('keeps a quantity between 0 and the most, and whole', () => {
    expect(quantityOf(setQuantity(EMPTY_CART, place, burger, 99).cart, 'a')).toBe(20);
    expect(quantityOf(setQuantity(EMPTY_CART, place, burger, 99, 5).cart, 'a')).toBe(5);
    expect(quantityOf(setQuantity(EMPTY_CART, place, burger, 2.9).cart, 'a')).toBe(2);
    expect(setQuantity(EMPTY_CART, place, burger, -3).cart).toEqual(EMPTY_CART);
    expect(setQuantity(EMPTY_CART, place, burger, NaN).cart).toEqual(EMPTY_CART);
  });

  it('refuses a dish from another restaurant while the cart has dishes, and leaves the cart as it was', () => {
    const cart = setQuantity(EMPTY_CART, place, burger, 1).cart;
    const other = setQuantity(cart, { placeId: 'P2', restaurantName: 'Cafe' }, fries, 1);
    expect(other.result).toBe('other_restaurant');
    expect(other.cart).toBe(cart);
  });

  it('lets a new restaurant start once the old cart is empty', () => {
    const result = setQuantity(EMPTY_CART, { placeId: 'P2', restaurantName: 'Cafe' }, fries, 1);
    expect(result.result).toBe('ok');
    expect(result.cart.placeId).toBe('P2');
  });

  it('turns the cart into the lines the server takes, with notes only where typed, and never a price', () => {
    let cart = setQuantity(EMPTY_CART, place, burger, 2).cart;
    cart = setQuantity(cart, place, fries, 1).cart;
    const items = cartToOrderItems(cart, { a: '  no onions ', b: '   ' });
    expect(items).toEqual([{ item_id: 'a', quantity: 2, note: 'no onions' }, { item_id: 'b', quantity: 1 }]);
    expect(JSON.stringify(items)).not.toContain('price');
  });
});

describe('reconcileCart', () => {
  const base: Cart = { placeId: 'P1', restaurantName: 'Diner', lines: [{ ...burger, quantity: 2 }, { ...fries, quantity: 1 }] };

  it('changes nothing when every dish is still on sale at its price', () => {
    const r = reconcileCart(base, [burger, fries]);
    expect(r.cart).toEqual(base);
    expect(r.removed).toEqual([]);
    expect(r.repriced).toEqual([]);
  });

  it('drops a dish that is gone and takes the new price of one that changed', () => {
    const r = reconcileCart(base, [{ ...burger, priceCents: 1400 }]);
    expect(r.removed).toEqual(['Fries']);
    expect(r.repriced).toEqual(['Burger']);
    expect(r.cart.lines).toEqual([{ itemId: 'a', name: 'Burger', priceCents: 1400, quantity: 2 }]);
  });

  it('empties the cart when nothing is left', () => {
    expect(reconcileCart(base, []).cart).toEqual(EMPTY_CART);
  });
});

describe('pickup times', () => {
  const NOW = Date.parse('2026-10-26T18:07:00Z');   // 1:07 pm in Chicago (CDT), 3:07 am next day in Tokyo

  it('reads the seconds since local midnight in the restaurant\'s timezone', () => {
    expect(secondsSinceLocalMidnight(NOW, 'America/Chicago')).toBe(13 * 3600 + 7 * 60);
    expect(secondsSinceLocalMidnight(NOW, 'UTC')).toBe(18 * 3600 + 7 * 60);
    expect(secondsSinceLocalMidnight(NOW, 'Not/AZone')).toBe(0);
  });

  it('starts at the first quarter hour at least the prep time away, in steps of 15 minutes', () => {
    const slots = pickupSlots(NOW, 20, 'America/Chicago');   // earliest 1:27 pm -> 1:30 pm
    expect(slots[0]).toBe(Date.parse('2026-10-26T18:30:00Z'));
    expect(slots[1] - slots[0]).toBe(SLOT_MINUTES * 60000);
    expect(slots[0]).toBeGreaterThanOrEqual(NOW + 20 * 60000);
  });

  it('is exactly on a quarter hour when the earliest time already is', () => {
    const slots = pickupSlots(Date.parse('2026-10-26T18:00:00Z'), 15, 'UTC');
    expect(slots[0]).toBe(Date.parse('2026-10-26T18:15:00Z'));
  });

  it('stops before the restaurant\'s day ends, and never past the cap', () => {
    const slots = pickupSlots(NOW, 20, 'America/Chicago');
    const midnightChicago = Date.parse('2026-10-27T05:00:00Z');
    expect(slots[slots.length - 1]).toBeLessThan(midnightChicago);
    expect(slots[slots.length - 1]).toBe(Date.parse('2026-10-27T04:45:00Z'));   // 11:45 pm
    expect(pickupSlots(Date.parse('2026-10-26T00:00:00Z'), 5, 'UTC').length).toBeLessThanOrEqual(64);
  });

  it('gives no times when the prep time runs past the end of the day', () => {
    expect(pickupSlots(Date.parse('2026-10-26T23:50:00Z'), 20, 'UTC')).toEqual([]);
  });
});

describe('order status', () => {
  it('reads each status in plain words', () => {
    expect(statusLabel('pending_payment')).toBe('Waiting for payment');
    expect(statusLabel('ready')).toBe('Ready for pickup');
    expect(statusLabel('mystery')).toBe('mystery');
  });
  it('knows when an order is finished', () => {
    for (const s of ['picked_up', 'cancelled', 'refunded']) expect(isFinal(s)).toBe(true);
    for (const s of ['pending_payment', 'placed', 'accepted', 'ready']) expect(isFinal(s)).toBe(false);
  });
  it('lets the customer cancel only before the restaurant accepts', () => {
    expect(canCancel('pending_payment')).toBe(true);
    expect(canCancel('placed')).toBe(true);
    for (const s of ['accepted', 'ready', 'picked_up', 'cancelled', 'refunded']) expect(canCancel(s)).toBe(false);
  });
  it('says what is happening with the money, and never claims a refund that has not happened', () => {
    expect(refundNote('cancelled', 'succeeded')).toBe('Your money has been refunded.');
    expect(refundNote('cancelled', 'pending')).toBe('Your refund is on its way.');
    expect(refundNote('cancelled', 'failed')).toContain('did not go through');
    expect(refundNote('cancelled', 'none')).toBeNull();
    expect(refundNote('placed', undefined)).toBeNull();
  });
});

describe('the order bar at the top of the app', () => {
  const order = (id: string, status: string): BannerOrder => ({ order_id: id, status, restaurant_name: 'Cactus Grill', created_at: '2026-10-26T17:55:00Z' });

  it('is active from the moment the order is paid until it is finished', () => {
    for (const s of ['placed', 'accepted', 'ready']) expect(isActiveOrder(order('o', s))).toBe(true);
    for (const s of ['picked_up', 'cancelled', 'refunded']) expect(isActiveOrder(order('o', s))).toBe(false);
  });

  it('never counts an unpaid order: it was not placed', () => {
    expect(isActiveOrder(order('o', 'pending_payment'))).toBe(false);
    expect(isPlacedOrder(order('o', 'pending_payment'))).toBe(false);
    for (const s of ['placed', 'accepted', 'ready', 'picked_up', 'cancelled', 'refunded']) expect(isPlacedOrder(order('o', s))).toBe(true);
  });

  it('leaves out a status it does not know', () => {
    expect(isActiveOrder(order('o', 'mystery'))).toBe(false);
  });

  it('is nothing when there are no orders, or none active', () => {
    expect(summarizeActiveOrders(null)).toBeNull();
    expect(summarizeActiveOrders(undefined)).toBeNull();
    expect(summarizeActiveOrders([])).toBeNull();
    expect(summarizeActiveOrders([order('a', 'picked_up'), order('b', 'cancelled'), order('c', 'pending_payment')])).toBeNull();
  });

  it('counts every placed order in progress', () => {
    const s = summarizeActiveOrders([order('a', 'placed'), order('b', 'ready'), order('c', 'accepted'), order('d', 'picked_up'), order('e', 'pending_payment')]);
    expect(s).toEqual({ count: 3 });
  });
});

describe('coupons on an order', () => {
  it('says what a coupon gives in plain words', () => {
    expect(couponTitle({ coupon_type: 'generic_percent', discount_value: 10 })).toBe('10% off your order');
    expect(couponTitle({ coupon_type: 'generic_fixed', discount_value: 2 })).toBe('$2.00 off your order');
    expect(couponTitle({ coupon_type: 'item_percent', discount_value: 12.5 }, 'Burger')).toBe('12.5% off Burger');
    expect(couponTitle({ coupon_type: 'item_fixed', discount_value: 1.5 }, 'Burger')).toBe('$1.50 off Burger');
    expect(couponTitle({ coupon_type: 'item_fixed', discount_value: 1.5 })).toBe('$1.50 off one dish');
  });

  it('explains that an item coupon covers one of the dish per order, and says nothing for a whole-order coupon', () => {
    expect(couponScopeNote({ coupon_type: 'item_percent' }, 'Burger')).toBe('Limit of 1 coupon per item per order (applies to one Burger).');
    expect(couponScopeNote({ coupon_type: 'item_fixed' })).toBe('Limit of 1 coupon per item per order (applies to one dish).');
    expect(couponScopeNote({ coupon_type: 'generic_percent' }, 'Burger')).toBeNull();
    expect(couponScopeNote({ coupon_type: 'generic_fixed' })).toBeNull();
  });

  it('takes the discount off the total, never below zero', () => {
    expect(totalAfterDiscount(3000, 500)).toBe(2500);
    expect(totalAfterDiscount(3000, 0)).toBe(3000);
    expect(totalAfterDiscount(300, 500)).toBe(0);
    expect(totalAfterDiscount(3000, -50)).toBe(3000);
  });
});

describe('newIdempotencyKey', () => {
  it('is a fresh, non-empty text each time', () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a.length).toBeGreaterThan(8);
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual(100);   // the server's limit
  });
});
