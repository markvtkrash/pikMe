jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { EMPTY_CART, cartCount, cartSubtotalCents } from '../utils/orders';
import { useOrderCartStore } from './orderCartStore';

const place = { placeId: 'P1', restaurantName: 'Diner' };
const burger = { itemId: 'a', name: 'Burger', priceCents: 1250 };
const fries = { itemId: 'b', name: 'Fries', priceCents: 500 };

beforeEach(() => {
  useOrderCartStore.setState({ cart: EMPTY_CART });
});

describe('order cart store', () => {
  it('starts empty', () => {
    expect(useOrderCartStore.getState().cart).toEqual(EMPTY_CART);
  });

  it('holds the dishes added, and adds them up', () => {
    const { setDishQuantity } = useOrderCartStore.getState();
    expect(setDishQuantity(place, burger, 2)).toBe('ok');
    expect(setDishQuantity(place, fries, 1)).toBe('ok');
    const { cart } = useOrderCartStore.getState();
    expect(cartCount(cart)).toBe(3);
    expect(cartSubtotalCents(cart)).toBe(3000);
    expect(cart.placeId).toBe('P1');
  });

  it('leaves the cart alone and says so when a dish from another restaurant is added', () => {
    const { setDishQuantity } = useOrderCartStore.getState();
    setDishQuantity(place, burger, 1);
    const before = useOrderCartStore.getState().cart;
    expect(setDishQuantity({ placeId: 'P2', restaurantName: 'Cafe' }, fries, 1)).toBe('other_restaurant');
    expect(useOrderCartStore.getState().cart).toBe(before);
  });

  it('starts a new restaurant once the cart is cleared', () => {
    const { setDishQuantity, clear } = useOrderCartStore.getState();
    setDishQuantity(place, burger, 1);
    clear();
    expect(useOrderCartStore.getState().cart).toEqual(EMPTY_CART);
    expect(setDishQuantity({ placeId: 'P2', restaurantName: 'Cafe' }, fries, 2)).toBe('ok');
    expect(useOrderCartStore.getState().cart.placeId).toBe('P2');
  });

  it('can have its cart replaced (after prices change, for example)', () => {
    useOrderCartStore.getState().setDishQuantity(place, burger, 1);
    useOrderCartStore.getState().replaceCart(EMPTY_CART);
    expect(useOrderCartStore.getState().cart).toEqual(EMPTY_CART);
  });
});
